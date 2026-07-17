'use strict'
const { hasCapability } = require('../authz')
const fleet = require('../fleet')
const { sse, emit, _forcedToolCall, groundingFlat } = require('./_shared')

const CHAT_OVERRIDE = process.env.AZURE_FOUNDRY_DEPLOYMENT || ''

const _EMIT_SCAFFOLD = {
  name: 'emit_product_scaffold',
  description: 'Emit a new product scaffold plan modelled on the existing portfolio. Only include coverages with a real portfolio analogue. Never invent a form number.',
  input_schema: {
    type: 'object',
    properties: {
      product: {
        type: 'object',
        properties: {
          name:      { type: 'string' },
          lobPrefix: { type: 'string', description: 'e.g. HO, PA, GL' },
          citation:  { type: 'string', description: 'Which reference product this is modelled after, e.g. [PH.PROD.001]' },
        },
        required: ['name', 'lobPrefix', 'citation'],
      },
      coverages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name:              { type: 'string' },
            requirement:       { type: 'string', enum: ['MANDATORY', 'OPTIONAL'] },
            premiumGenerating: { type: 'boolean' },
            formNumbers:       { type: 'array', items: { type: 'string' } },
            citation:          { type: 'string', description: 'Bracketed [refId] from context, e.g. [PH.COV.001]' },
          },
          required: ['name', 'requirement', 'premiumGenerating', 'citation'],
        },
      },
      forms: {
        type: 'array',
        items: {
          type: 'object',
          properties: { number: { type: 'string' }, name: { type: 'string' }, citation: { type: 'string' } },
          required: ['number', 'name', 'citation'],
        },
      },
    },
    required: ['product'],
  },
}

const SCAFFOLD_SYSTEM = [
  'You are the Product Reinvention Hub product-scaffolding assistant for P&C product managers.',
  'Build a new product scaffold by modelling it closely on the best-matching reference line in the CONTEXT below.',
  'RULES: 1. Cite a real [refId] from context behind every proposed coverage. 2. Never invent a coverage, form number, or limit not supported by context. 3. Call `emit_product_scaffold` exactly once as your only action.',
  'If context is thin, propose fewer items rather than padding with invented content.',
].join(' ')

async function scaffoldProduct(req, res) {
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
    emit(res, { t: 'tool', name: 'load:context', phase: 'start', summary: 'Loading portfolio context' })
    const ctx = await groundingFlat(instruction, null, req.user.tenantId)
    emit(res, { t: 'tool', name: 'load:context', phase: 'end', summary: `${ctx.length} context chunk(s) found` })
    const systemBlocks = [
      { type: 'text', text: SCAFFOLD_SYSTEM, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: `\n\nCONTEXT:\n${ctx.length ? ctx.join('\n\n---\n\n') : '(no matching context found)'}` },
    ]
    emit(res, { t: 'tool', name: 'emit_product_scaffold', phase: 'start', summary: 'Scaffolding product from context' })
    // No extended thinking: it is incompatible with forced tool_choice, and the legacy
    // {type:'enabled',budget_tokens} form 400s on opus-4-8. The forced emit_product_scaffold
    // tool already gives structured output. (Adaptive thinking is a separate Foundry-gated change.)
    const raw = await _forcedToolCall(deployment, systemBlocks, [_EMIT_SCAFFOLD], 'emit_product_scaffold', [], instruction, 4096)
    const proposed = Array.isArray(raw.coverages) ? raw.coverages : []
    const coverages = proposed.filter((c) => c && c.name && c.citation)
    const forms = (Array.isArray(raw.forms) ? raw.forms : []).filter((f) => f && f.number && f.citation)
    const warnings = coverages.length < proposed.length ? ['Some coverages dropped — missing required citation.'] : []
    const scaffold = { product: raw.product || null, coverages: { items: coverages }, forms: { items: forms }, rules: { items: [] }, warnings }
    emit(res, { t: 'tool', name: 'emit_product_scaffold', phase: 'end', summary: `${coverages.length} coverage(s) scaffolded` })
    emit(res, { t: 'json', key: 'scaffold', value: scaffold })
    emit(res, { t: 'done' }); res.end()
  } catch (err) {
    emit(res, { t: 'error', message: `Scaffold error: ${String((err && err.message) || err).slice(0, 220)}` })
    emit(res, { t: 'done' }); res.end()
  }
}

module.exports = { scaffoldProduct }
