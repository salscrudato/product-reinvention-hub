// summarize.ts — summarizeProduct: a cheap, fast, grounded product summary generated
// purely from the product's STRUCTURED METADATA (coverages, rules, rating, footprint) —
// it never reads a form PDF. The client passes the already-loaded metadata; the model
// returns a structured dashboard payload via a forced tool, so the result is deterministic
// in shape and can only describe what the metadata actually contains. Uses the fast model
// (haiku) with a timeout. Any signed-in role may summarize (read-only). AWS-SWAP: onCall
// → Lambda URL; auth + secret handling live in runtime.ts.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, MODEL_FAST, ANTHROPIC_API_KEY } from './runtime'
import { emptyUsage, addUsage, recordUsage } from './telemetry'

interface CoverageMeta { name: string; requirement?: string; rated?: boolean; sub?: boolean; forms?: string[]; limit?: string }
interface SummarizeBody {
  product: {
    name: string; lob?: string; marketSegment?: string; statesCount?: number; allStates?: boolean
    coverages?: CoverageMeta[]
    rules?: { condition: string; outcome: string }[]
    rating?: { steps: number; minimumPremium?: number }
    forms?: { number: string; name?: string }[]
    // The base coverage form the product was created on (identify pass). When present,
    // the summary is grounded in it — the form number/title anchors what the product is.
    baseForm?: { number?: string; title?: string; edition?: string }
  }
}

const SUMMARY_TOOL: Anthropic.Tool = {
  name: 'product_summary',
  description:
    'Return a concise, executive product summary built ONLY from the metadata provided. ' +
    'Never invent coverages, forms, limits, states or rules that are not in the input. If the ' +
    'metadata is thin, keep the summary short rather than padding it.',
  input_schema: {
    type: 'object',
    properties: {
      headline: { type: 'string', description: 'One crisp positioning line, e.g. "An ISO-style HO-3 open-peril homeowners product across 15 states."' },
      overview: { type: 'string', description: '2–3 plain-English sentences describing what this product is and who it serves, grounded in the metadata.' },
      highlights: {
        type: 'array', description: '3–5 at-a-glance facts as label/value tiles (e.g. Coverages: 10; Footprint: 15 states; Rating: 11 steps; Min premium: $500).',
        items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' } }, required: ['label', 'value'] },
      },
      coverageHighlights: {
        type: 'array', description: 'The most important coverages, each with a one-line plain-English note. Only coverages present in the metadata.',
        items: { type: 'object', properties: { name: { type: 'string' }, note: { type: 'string' } }, required: ['name', 'note'] },
      },
      considerations: { type: 'array', description: 'Notable rules, constraints or gaps a product manager should know, drawn from the rules/metadata. Empty if none.', items: { type: 'string' } },
    },
    required: ['headline', 'overview', 'highlights', 'coverageHighlights'],
  },
}

export const summarizeProduct = onCall<SummarizeBody>(
  { secrets: [ANTHROPIC_API_KEY], maxInstances: 5, timeoutSeconds: 60, memory: '512MiB' },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in to generate a summary.')
    const p = req.data?.product
    if (!p?.name) throw new HttpsError('invalid-argument', 'No product metadata provided.')

    // Compact, deterministic metadata block — the only grounding the model gets.
    const meta = JSON.stringify(p)
    const usageAccum = emptyUsage()
    const t0 = Date.now()
    let ok = true
    try {
      const msg = await anthropic().messages.create({
        model:       MODEL_FAST,
        max_tokens:  1200,
        system:
          'You are a P&C insurance product analyst. Summarize a product for its product manager ' +
          'using ONLY the structured metadata provided. When a `baseForm` is present, treat it as ' +
          'the coverage form the product is built on — ground the headline/overview in it and cite ' +
          'its form number (e.g. "Built on HO 00 03"). Be concise, concrete and executive in tone. ' +
          'Never invent facts. Then call product_summary once.',
        tools:       [SUMMARY_TOOL],
        tool_choice: { type: 'tool', name: 'product_summary' },
        messages:    [{ role: 'user', content: `PRODUCT METADATA (JSON):\n\n${meta}\n\nSummarize this product, then call product_summary.` }],
      }, { timeout: 45_000 })
      addUsage(usageAccum, msg.usage)
      const tu = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      return (tu?.input as Record<string, unknown> | undefined) ?? {}
    } catch (err) {
      ok = false
      throw err
    } finally {
      void recordUsage({ feature: 'summarizeProduct', model: MODEL_FAST, usage: usageAccum, latencyMs: Date.now() - t0, ok })
    }
  },
)
