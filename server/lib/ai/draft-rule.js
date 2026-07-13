'use strict'
const { hasCapability } = require('../authz')
const fleet = require('../fleet')
const { sse, emit, _forcedToolCall, groundingFlat } = require('./_shared')

const CHAT_OVERRIDE = process.env.AZURE_FOUNDRY_DEPLOYMENT || ''

const _EMIT_RULE = {
  name: 'emit_rule_draft',
  description: 'Emit one product rule as a precise IF->THEN statement. Cite only real entities from the context. Never invent a coverage refId or form number.',
  input_schema: {
    type: 'object',
    properties: {
      category:       { type: 'string', enum: ['PRODUCT', 'RATING', 'FORMS'] },
      subCategory:    { type: 'string' },
      condition:      { type: 'string', description: 'The IF clause — precise, testable, cites [refId] from context.' },
      outcome:        { type: 'string', description: 'The THEN clause — what happens when condition is met.' },
      coverageRefIds: { type: 'array',  items: { type: 'string' }, description: 'Bracketed [refId]s from context only.' },
      formNumbers:    { type: 'array',  items: { type: 'string' }, description: 'Form numbers that appear verbatim in context only.' },
      rationale:      { type: 'array',  items: { type: 'string' } },
      citations:      { type: 'array',  items: { type: 'string' } },
    },
    required: ['category', 'subCategory', 'condition', 'outcome'],
  },
}

const DRAFT_RULE_SYSTEM = [
  'You are the Product Reinvention Hub rule-drafting assistant for P&C product managers.',
  'Draft or refine exactly ONE product rule as a precise IF->THEN statement using the CONTEXT below.',
  'RULES: 1. Category is PRODUCT, RATING, or FORMS. 2. Cite only real [refId]s from context. 3. Keep condition and outcome concise and unambiguous. 4. Call `emit_rule_draft` exactly once.',
].join(' ')

async function draftRule(req, res) {
  if (!hasCapability(req.user, 'product:write'))
    return res.status(403).json({ error: 'forbidden', need: 'product:write', have: req.user.role })
  const body = req.body || {}
  const instruction = String(body.instruction || '').trim()
  sse(res)
  if (!instruction) { emit(res, { t: 'error', message: 'instruction is required.' }); emit(res, { t: 'done' }); return res.end() }
  const g = fleet.guard()
  if (!g.allow) { emit(res, { t: 'error', message: 'AI budget ceiling reached — try again shortly.' }); emit(res, { t: 'done' }); return res.end() }
  const deployment = CHAT_OVERRIDE || fleet.resolveModel('GROUNDED_CITED', g.degrade)
  try {
    const queryTerm = instruction + (body.productId ? ` ${body.productId}` : '')
    emit(res, { t: 'tool', name: 'load:context', phase: 'start', summary: 'Loading portfolio context' })
    const ctx = await groundingFlat(queryTerm, body.productId || null, req.user.tenantId)
    emit(res, { t: 'tool', name: 'load:context', phase: 'end', summary: `${ctx.length} context chunk(s) found` })
    const existingNote = body.existingRule ? `\n\nEXISTING RULE TO REFINE:\ncategory: ${body.existingRule.category || ''}\nsubCategory: ${body.existingRule.subCategory || ''}\ncondition: ${body.existingRule.condition || ''}\noutcome: ${body.existingRule.outcome || ''}\nPreserve intent and refId; change only what the instruction requests.` : ''
    const systemBlocks = [
      { type: 'text', text: DRAFT_RULE_SYSTEM, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: `${existingNote}\n\nCONTEXT:\n${ctx.length ? ctx.join('\n\n---\n\n') : '(no matching context found)'}` },
    ]
    emit(res, { t: 'tool', name: 'emit_rule_draft', phase: 'start', summary: 'Drafting rule' })
    const raw = await _forcedToolCall(deployment, systemBlocks, [_EMIT_RULE], 'emit_rule_draft', [], instruction, 4096)
    const draft = {
      category:       raw.category || 'PRODUCT',
      subCategory:    raw.subCategory || 'general',
      condition:      raw.condition || '',
      outcome:        raw.outcome || '',
      coverageRefIds: Array.isArray(raw.coverageRefIds) ? raw.coverageRefIds : [],
      formNumbers:    Array.isArray(raw.formNumbers) ? raw.formNumbers : [],
      rationale:      Array.isArray(raw.rationale) ? raw.rationale : [],
      citations:      Array.isArray(raw.citations) ? raw.citations : [],
      warnings:       [],
    }
    emit(res, { t: 'tool', name: 'emit_rule_draft', phase: 'end', summary: `${draft.category}/${draft.subCategory} rule drafted` })
    emit(res, { t: 'json', key: 'rule_draft', value: draft })
    emit(res, { t: 'done' }); res.end()
  } catch (err) {
    emit(res, { t: 'error', message: `Rule draft error: ${String((err && err.message) || err).slice(0, 220)}` })
    emit(res, { t: 'done' }); res.end()
  }
}

module.exports = { draftRule }
