'use strict'
// task-summary.js — grounded one-paragraph synthesis of the tenant's task load
// (open, overdue, due in the next 7 days) for the Home Priorities panel.
//
// Grounding is strictly server-side: the roster of tasks comes from Cosmos for
// the JWT's tenant — never from the request body. The model runs on the
// MID_REASONER fleet role and must cite task ids from the roster in [brackets];
// citations that don't resolve to a real roster id are stripped, and a summary
// with zero surviving citations is refused (grounded + cited, never invented).
const fleet = require('../fleet')
const { _forcedToolCall } = require('./_shared')

const SUMMARY_TOOL = {
  name: 'emit_task_summary',
  description: 'Emit the one-paragraph task summary.',
  input_schema: {
    type: 'object',
    properties: { summary: { type: 'string', description: 'One tight paragraph, ≤ 90 words, citing task ids in [brackets].' } },
    required: ['summary'],
  },
}

const SYSTEM = [
  'You are a product-operations chief of staff. You are given a roster of real launch tasks',
  '(id | title | due | status | owner). Write EXACTLY ONE tight paragraph (max 90 words, no',
  'headings, no lists) that synthesizes what needs attention: lead with overdue work, then the',
  'next 7 days, then overall open load. Cite the specific tasks you mention using their id in',
  '[square brackets], e.g. [gtm-project-123-pm-a1b2c3d4]. Cite ONLY ids present in the roster —',
  'never invent an id, a task, or a date. Use the exact counts you are given.',
].join(' ')

const CITE_RE = /\[([^\]]+)\]/g

/** ISO date (UTC) for "today" — tasks store ISO dates, compare lexically. */
const todayISO = () => new Date().toISOString().slice(0, 10)

function bucketize(tasks) {
  const today = todayISO()
  const week = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  const open = tasks.filter(t => !t.done)
  const overdue = open.filter(t => typeof t.dueAt === 'string' && t.dueAt.slice(0, 10) < today && !t.ongoing)
  const next7 = open.filter(t => {
    const d = typeof t.dueAt === 'string' ? t.dueAt.slice(0, 10) : null
    return d && d >= today && d <= week
  })
  // dueToday (additive, consumed by the daily brief's buckets): the next7 slice due today.
  const dueToday = next7.filter(t => typeof t.dueAt === 'string' && t.dueAt.slice(0, 10) === today)
  return { open, overdue, next7, dueToday }
}

/** Keep only [citations] whose id is in validIds; drop the rest verbatim-safe. */
function _stripUncited(raw, validIds) {
  const cited = []
  const summary = raw.replace(CITE_RE, (m, id) => {
    const k = String(id).trim()
    if (validIds.has(k)) { cited.push(k); return `[${k}]` }
    return ''
  }).replace(/\s{2,}/g, ' ').trim()
  return { summary, cited }
}

const rosterLine = t =>
  `${t.id} | ${String(t.title || '').slice(0, 80)} | due ${typeof t.dueAt === 'string' ? t.dueAt.slice(0, 10) : 'none'} | ${t.done ? 'done' : t.ongoing ? 'ongoing' : 'open'} | ${t.ownerRole || t.assignee || 'unassigned'}`

/**
 * The composition core, extracted so the daily brief (daily-brief.js) can embed the
 * SAME grounded paragraph + citations verbatim (HOME_BRIEF_SPEC §1.1) instead of
 * re-summarizing. Pure of HTTP: returns a discriminated union; the taskSummary
 * handler below maps it onto the historical wire shapes byte-for-byte.
 *   { kind:'ok',    summary, counts, citedIds, deployment, generatedAt }
 *   { kind:'empty', counts, generatedAt }                  // no open tasks — no model call
 *   { kind:'error', error:'tasks_unavailable'|'uncited_summary'|'ai_upstream', detail }
 */
async function composeTaskSummary(tid, { degrade = false } = {}) {
  // Server-side roster read — same entity-row shape as /api/db/list.
  let rows
  try {
    const { docs } = require('../cosmos').resolveTenantStore(tid)
    const sql = "SELECT TOP 500 c.data, c.path FROM c WHERE c.kind='entity' AND c.coll='tasks' AND c.tenantId=@tid"
    const { resources } = await docs.items.query(
      { query: sql, parameters: [{ name: '@tid', value: tid }] },
      { maxItemCount: 500 },
    ).fetchAll()
    rows = resources.map(r => ({ id: String(r.path || '').split('/').filter(Boolean).at(-1), ...r.data }))
  } catch (e) {
    return { kind: 'error', error: 'tasks_unavailable', detail: e.message }
  }

  const { open, overdue, next7, dueToday } = bucketize(rows)
  const counts = { open: open.length, overdue: overdue.length, next7: next7.length, dueToday: dueToday.length }
  if (open.length === 0) {
    // Nothing to synthesize — an honest empty result, no model call spent.
    return { kind: 'empty', counts, generatedAt: new Date().toISOString() }
  }

  // Compact roster: every overdue task, the next-7-day slate, then a slice of the
  // remaining open backlog for context. Ids in the roster are the citable set.
  const seen = new Set()
  const roster = []
  for (const t of [...overdue, ...next7, ...open]) {
    if (!t.id || seen.has(t.id)) continue
    seen.add(t.id)
    roster.push(rosterLine(t))
    if (roster.length >= 60) break
  }

  const instruction = [
    `Today is ${todayISO()}. Counts (authoritative, computed from the board): ${counts.open} open,`,
    `${counts.overdue} overdue, ${counts.next7} due in the next 7 days.`,
    'Task roster (id | title | due | status | owner):\n' + roster.join('\n'),
  ].join(' ')

  const deployment = fleet.resolveModel('MID_REASONER', degrade)
  try {
    let summary = ''
    let cited = []
    for (let attempt = 0; attempt < 2 && cited.length === 0; attempt++) {
      const out = await _forcedToolCall(
        deployment, SYSTEM, [SUMMARY_TOOL], 'emit_task_summary', [],
        attempt === 0 ? instruction : `${instruction}\nYour previous answer cited no valid roster ids. Cite at least one real [id] from the roster.`,
        1024,
      )
      const raw = String(out.summary || '').trim()
      // Strip citations that don't resolve to a roster id — never show an invented one.
      const stripped = _stripUncited(raw, seen)
      summary = stripped.summary
      cited = stripped.cited
    }
    if (!summary || cited.length === 0) {
      return { kind: 'error', error: 'uncited_summary', detail: 'The model produced no verifiable task citations.' }
    }
    return { kind: 'ok', summary, counts, citedIds: [...new Set(cited)], deployment, generatedAt: new Date().toISOString() }
  } catch (e) {
    return { kind: 'error', error: 'ai_upstream', detail: e.message }
  }
}

// HTTP shim — wire shapes identical to the pre-extraction handler (counts gains the
// additive dueToday key; existing consumers read open/overdue/next7 as before).
async function taskSummary(req, res) {
  const tid = req.user?.tenantId
  if (!tid) return res.status(401).json({ error: 'unauthenticated' })

  const g = fleet.guard()
  if (!g.allow) return res.status(429).json({ error: 'ai_budget_exceeded', detail: g.reason })

  const r = await composeTaskSummary(tid, { degrade: g.degrade })
  if (r.kind === 'error') {
    const code = r.error === 'tasks_unavailable' ? 503 : r.error === 'uncited_summary' ? 422 : 502
    return res.status(code).json({ error: r.error, detail: r.detail })
  }
  if (r.kind === 'empty') {
    return res.json({ summary: null, counts: r.counts, deployment: null, generatedAt: r.generatedAt })
  }
  return res.json({ summary: r.summary, counts: r.counts, citedIds: r.citedIds, deployment: r.deployment, generatedAt: r.generatedAt })
}

module.exports = { taskSummary, composeTaskSummary, _stripUncited, _bucketize: bucketize }
