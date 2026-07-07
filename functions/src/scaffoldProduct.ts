// scaffoldProduct.ts — the grounded "scaffold a new product" composer. A product
// manager describes the product they want to build; the model reads the REAL
// portfolio via the grounding tools (existing products, coverages, forms, rules),
// then proposes a starting structure — a product shell plus coverages and rules —
// modelled on what already exists, and emits it via one forced tool.
//
// Two guarantees keep this grounded rather than free invention (identical to the rule
// composer in rules.ts):
//   • The pure `cleanScaffold` sanitizer drops any proposal without a citation.
//   • Every proposed reference is then VERIFIED server-side against Firestore before
//     we hand the plan back: the product's line must be a registered LOB, and every
//     form number a coverage/rule references must resolve to a real form. Anything
//     that doesn't resolve is dropped and reported as a warning — so the scaffold that
//     reaches the UI (and, on confirm, mutate()) can never carry an invented line or
//     form. refIds are allocated by the app at persist time, never by the model.
//
// Writes NOTHING itself — the browser persists the (edited) draft through the adapter's
// atomic mutate(). EDITOR/ADMIN only (mirrors the Firestore rules the eventual
// mutate() hits — role enforced on BOTH sides). AWS-SWAP: onRequest → Lambda URL.
import { onRequest } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, authenticate, AuthError, openSse, send, ANTHROPIC_API_KEY } from './runtime'
import { runChatAgent } from './ai'
import { TOOLS, runTool } from './tools'
import type { ToolOutput } from './tools'
import { cleanScaffold, resolveLobByRefId, type ScaffoldPlan } from '@pf/shared'

// ─── The forced final tool (the scaffold card contract) ─────────────────────────
// Field fragments shared with extract.ts so every proposal is cited by construction.
const CONFIDENCE = { type: 'number', description: '0..1 confidence this proposal fits the requested product, given the real portfolio you read.' } as const
const CITATION   = { type: 'string', description: 'The existing product / coverage / form (by refId or number) you modelled this on. REQUIRED — proposals without a citation are discarded.' } as const

const EMIT_SCAFFOLD_TOOL: Anthropic.Tool = {
  name: 'emit_product_scaffold',
  description:
    'Record the proposed product scaffold. Call this exactly once, as your FINAL action, ' +
    'after you have read the real portfolio with the other tools. Model the scaffold on an ' +
    'EXISTING line/product — every coverage, form and rule MUST cite the real entity it was ' +
    'modelled on. Never invent a coverage that has no analogue, a form number that does not ' +
    'exist, or a line that is not in the portfolio. If you cannot ground something, omit it ' +
    'and note the gap.',
  input_schema: {
    type: 'object',
    properties: {
      product: {
        type: 'object',
        description: 'The product shell to create.',
        properties: {
          name:          { type: 'string', description: 'The product name the manager asked for, e.g. "Coastal Homeowners HO-3".' },
          lobPrefix:     { type: 'string', description: 'The line-of-business prefix of the reference line — MUST be one you saw in the portfolio, e.g. "HO" or "GL".' },
          marketSegment: { type: 'string', description: 'Market segment, e.g. "Personal Lines / Property".' },
          description:   { type: 'string', description: 'One or two sentences describing the product.' },
          citation:      CITATION,
        },
        required: ['name', 'lobPrefix', 'citation'],
      },
      coverages: {
        type: 'array',
        description: 'Coverages the new product should start with, modelled on the reference line.',
        items: {
          type: 'object',
          properties: {
            name:              { type: 'string' },
            requirement:       { type: 'string', enum: ['MANDATORY', 'OPTIONAL'] },
            premiumGenerating: { type: 'boolean' },
            formNumbers:       { type: 'array', items: { type: 'string' }, description: 'Real ISO/proprietary form numbers from the portfolio, e.g. "HO 00 03". Only numbers that exist.' },
            limitHint:         { type: 'string' },
            confidence:        CONFIDENCE,
            citation:          CITATION,
          },
          required: ['name', 'requirement', 'premiumGenerating', 'citation'],
        },
      },
      forms: {
        type: 'array',
        description: 'Existing forms this product should reference (base coverage form, key endorsements). Only real form numbers.',
        items: {
          type: 'object',
          properties: {
            number:              { type: 'string' },
            name:                { type: 'string' },
            edition:             { type: 'string' },
            category:            { type: 'string', enum: ['BASE_COVERAGE', 'DECLARATIONS', 'ENDORSEMENT', 'EXCLUSION', 'AMENDATORY', 'POLICY_NOTICE'] },
            mandatoryDefault:    { type: 'boolean' },
            attachmentCondition: { type: 'string', enum: ['RULE', 'NONE'] },
            confidence:          CONFIDENCE,
            citation:            CITATION,
          },
          required: ['number', 'category', 'citation'],
        },
      },
      rules: {
        type: 'array',
        description: 'Starting product/forms rules as short IF → THEN statements, modelled on the reference line\'s rules.',
        items: {
          type: 'object',
          properties: {
            category:      { type: 'string', enum: ['PRODUCT', 'FORMS'] },
            subCategory:   { type: 'string' },
            condition:     { type: 'string' },
            outcome:       { type: 'string' },
            coverageNames: { type: 'array', items: { type: 'string' }, description: 'Names of the coverages (above) this rule governs.' },
            formNumbers:   { type: 'array', items: { type: 'string' }, description: 'Real form numbers this rule attaches — only numbers that exist.' },
            confidence:    CONFIDENCE,
            citation:      CITATION,
          },
          required: ['category', 'condition', 'outcome', 'citation'],
        },
      },
      note: { type: 'string', description: 'Optional caveats or gaps — e.g. a reference you could not ground.' },
    },
    required: ['product'],
  },
}

const SCAFFOLD_TOOLS: Anthropic.Tool[] = [...TOOLS, EMIT_SCAFFOLD_TOOL]

const SCAFFOLD_SYSTEM = `You are the Product Reinvention Hub product-scaffolding assistant for P&C product managers. You propose the STARTING STRUCTURE of a NEW product — a product shell plus its initial coverages and rules — grounded entirely in the real portfolio.

WORKFLOW:
1. Use the grounding tools SILENTLY first. Find the closest existing line/product to what the manager asked for (search_entities, then get_product_tree / get_coverage / get_forms / get_rules). Never narrate your process; the manager sees only the finished scaffold.
2. Model the new product on that reference line. Propose coverages that mirror the reference line's real coverages (adapted to the request), reference only forms whose numbers actually exist, and draft a few starting rules like the line's real ones.
3. Cite the real entity behind every proposal: the reference product refId for the shell, a coverage refId or form number for each coverage/form/rule. If you cannot ground something, DO NOT include it — omit it and note the gap.
4. Never invent a coverage with no analogue, a form number that does not exist, or a line that is not in the portfolio. The line you choose (lobPrefix) must be one you actually saw.
5. Call emit_product_scaffold exactly once as your final action. Do not write prose after it.`

// ─── Server-side verification (the "never invents" guarantee) ────────────────────

/** Keep only the references that actually exist: the line must be a registered LOB,
 *  and every form number a coverage/form/rule cites must resolve to a real form.
 *  Mirrors verifyDraft() in rules.ts. Returns the cleaned plan + a warning per drop. */
async function verifyScaffold(input: Record<string, unknown>): Promise<ScaffoldPlan> {
  const plan = cleanScaffold(input)          // pure: shape + mandatory-citation guard
  const db = getFirestore()
  const warnings = [...plan.warnings]

  // 1) Line-of-business must be a registered line — a fabricated line is dropped.
  if (plan.product) {
    const lob = resolveLobByRefId(`${plan.product.lobPrefix}.LOB.001`)
    if (!lob || lob.prefix !== plan.product.lobPrefix) {
      warnings.push(`Product proposal dropped: "${plan.product.lobPrefix}" is not a registered line of business.`)
      plan.product = null
    } else if (!plan.product.marketSegment) {
      plan.product.marketSegment = `${lob.vertical} / ${lob.family}`
    }
  }

  // 2) Every referenced form number must resolve to a real form. Verify each unique
  //    number once, then filter the sections against the verified set.
  const referenced = new Set<string>([
    ...plan.forms.items.map(f => f.number),
    ...plan.coverages.items.flatMap(c => c.formNumbers),
    ...plan.rules.items.flatMap(r => r.formNumbers),
  ].filter(Boolean))
  const validForms = new Set<string>()
  for (const num of referenced) {
    const snap = await db.collection('forms').where('number', '==', num).limit(1).get()
    if (!snap.empty) validForms.add(num)
    else warnings.push(`Dropped unverified form ${num}`)
  }

  plan.forms.items = plan.forms.items.filter(f => validForms.has(f.number))
  plan.coverages.items = plan.coverages.items.map(c => ({ ...c, formNumbers: c.formNumbers.filter(n => validForms.has(n)) }))
  plan.rules.items = plan.rules.items.map(r => ({ ...r, formNumbers: r.formNumbers.filter(n => validForms.has(n)) }))

  plan.warnings = warnings
  return plan
}

// ─── scaffoldProduct — the grounded composer (SSE) ───────────────────────────────

interface ScaffoldBody { instruction?: string; lobPrefix?: string }

export const scaffoldProduct = onRequest(
  { secrets: [ANTHROPIC_API_KEY], cors: true, timeoutSeconds: 300, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

    // Author-only: scaffolding proposes writes, so guard like a mutation — role enforced
    // HERE and in Firestore rules on the eventual mutate() (both sides, always).
    let caller
    try { caller = await authenticate(req) }
    catch (e) { res.status(401).json({ error: e instanceof AuthError ? e.message : 'Unauthorized' }); return }
    if (caller.role !== 'EDITOR' && caller.role !== 'ADMIN') {
      res.status(403).json({ error: 'Editor access required to scaffold products.' }); return
    }

    openSse(res)
    try {
      const body        = (req.body ?? {}) as ScaffoldBody
      const instruction = body.instruction?.trim()
      if (!instruction) { send(res, { t: 'error', message: 'Describe the product you want to scaffold.' }); return }

      const parts: string[] = []
      if (body.lobPrefix) {
        parts.push(`Prefer the ${body.lobPrefix} line as the reference (use its coverages, forms and rules), unless the request clearly points elsewhere.`)
      }
      parts.push(`Product manager's request: ${instruction}`)

      // Custom executor: verify + surface the structured scaffold as a `json` event;
      // delegate every grounding tool to the shared runTool.
      const runScaffoldTool = async (name: string, toolInput: Record<string, unknown>): Promise<ToolOutput> => {
        if (name === 'emit_product_scaffold') {
          const plan = await verifyScaffold(toolInput)
          send(res, { t: 'json', key: 'scaffold', value: plan })
          const n = (plan.product ? 1 : 0) + plan.coverages.items.length + plan.rules.items.length
          return {
            content: JSON.stringify({ recorded: true, warnings: plan.warnings }),
            summary: plan.warnings.length ? `scaffold ready (${plan.warnings.length} dropped)` : `scaffold ready (${n} items)`,
          }
        }
        return runTool(name, toolInput)
      }

      await runChatAgent(anthropic(), [{ role: 'user', content: parts.join('\n\n') }], res, {
        system:    SCAFFOLD_SYSTEM,
        tools:     SCAFFOLD_TOOLS,
        runTool:   runScaffoldTool,
        maxTokens: 2600,
        maxTurns:  8,
      })
      send(res, { t: 'done' })
    } catch (err) {
      send(res, { t: 'error', message: err instanceof Error ? err.message : 'Scaffold failed.' })
    } finally {
      res.end()
    }
  },
)
