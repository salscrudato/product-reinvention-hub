// summarize.ts — summarizeProduct: a cheap, fast, grounded product summary generated
// purely from the product's STRUCTURED METADATA (coverages, rules, rating, footprint) —
// it never reads a form PDF. The client passes the already-loaded metadata; the model
// returns a structured dashboard payload via a forced tool, so the result is deterministic
// in shape and can only describe what the metadata actually contains. Uses the fast model
// (haiku) with a timeout. Any signed-in role may summarize (read-only).
// → Lambda URL; auth + secret handling live in runtime.ts.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, MODEL_FAST, ANTHROPIC_API_KEY, CACHE_1H } from './runtime'
import { emptyUsage, addUsage, recordUsage } from './telemetry'
import { guardSpend } from './costGuard'

interface CoverageMeta { name: string; requirement?: string; rated?: boolean; sub?: boolean; forms?: string[]; limit?: string }
interface SummarizeBody {
  // The product doc id — when present the grounded summary is PERSISTED to
  // `productSummaries/{productId}` (Admin SDK) so the Overview tab loads it instantly
  // on the next visit, from any device, without re-billing the model.
  productId?: string
  // A cheap content signal (hash of the metadata block) stored with the summary so the
  // client can tell when the product changed since the cached summary was generated.
  metaHash?: string
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

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

// C1 (grounded posture, applied to the summary): the model builds the summary purely
// from the client-supplied metadata, but nothing stops it naming a coverage the metadata
// does not contain. Drop any coverageHighlight whose name doesn't correspond to a real
// metadata coverage, so an invented coverage never reaches the dashboard. Tolerant match
// (either name contains the other, ignoring case/punctuation) so "Coverage A" still
// grounds against "Coverage A — Dwelling". Mirrors extraction's "drop the ungrounded".
function groundSummary(raw: Record<string, unknown>, coverages: CoverageMeta[]): Record<string, unknown> {
  const known = coverages.map(c => norm(c.name)).filter(Boolean)
  const highlights = Array.isArray(raw.coverageHighlights) ? raw.coverageHighlights : []
  const grounded = highlights.filter(h => {
    const n = norm(String((h as { name?: unknown }).name ?? ''))
    return !!n && known.some(k => k.includes(n) || n.includes(k))
  })
  return { ...raw, coverageHighlights: grounded }
}

export const summarizeProduct = onCall<SummarizeBody>(
  { secrets: [ANTHROPIC_API_KEY], maxInstances: 5, timeoutSeconds: 60, memory: '512MiB' },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in to generate a summary.')
    const p = req.data?.product
    if (!p?.name) throw new HttpsError('invalid-argument', 'No product metadata provided.')

    // Part C — respect the hard global ceiling + provider breaker (this is already the cheap
    // model, so there is no cheaper path to degrade to — block cleanly instead).
    const sessionKey = req.auth.uid
    const guard = await guardSpend({ feature: 'summarizeProduct', sessionKey })
    if (guard.action === 'deny' || guard.breakerOpen) {
      void recordUsage({ feature: 'summarizeProduct', model: MODEL_FAST, usage: emptyUsage(), latencyMs: 0, ok: true, sessionKey, denied: guard.action === 'deny', degraded: guard.breakerOpen, providerCalled: false })
      throw new HttpsError('resource-exhausted', guard.action === 'deny'
        ? 'AI is temporarily limited — the daily budget ceiling has been reached.'
        : 'The AI service is temporarily unavailable. Please try again shortly.')
    }

    // Compact, deterministic metadata block — the only grounding the model gets.
    const meta = JSON.stringify(p)
    const usageAccum = emptyUsage()
    const t0 = Date.now()
    let ok = true
    try {
      const msg = await anthropic().messages.create({
        model:       MODEL_FAST,
        max_tokens:  1200,
        // Stable instruction + tool def are the cacheable prefix (1h TTL); only the per-
        // product metadata in the user message below is volatile, and it sits after the
        // breakpoint so it never busts the cache. (Haiku's 4096-token cache floor means this
        // prefix only starts caching once it grows past the floor — a no-op until then, and
        // free thereafter.)
        system:      [{
          type: 'text',
          text:
            'You are a P&C insurance product analyst. Summarize a product for its product manager ' +
            'using ONLY the structured metadata provided. When a `baseForm` is present, treat it as ' +
            'the coverage form the product is built on — ground the headline/overview in it and cite ' +
            'its form number (e.g. "Built on HO 00 03"). Be concise, concrete and executive in tone. ' +
            'Never invent facts. Then call product_summary once.',
          cache_control: CACHE_1H,
        }],
        tools:       [SUMMARY_TOOL],
        tool_choice: { type: 'tool', name: 'product_summary' },
        messages:    [{ role: 'user', content: `PRODUCT METADATA (JSON):\n\n${meta}\n\nSummarize this product, then call product_summary.` }],
      }, { timeout: 45_000 })
      addUsage(usageAccum, msg.usage)
      const tu = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      const summary = groundSummary((tu?.input as Record<string, unknown> | undefined) ?? {}, p.coverages ?? [])

      // Persist the grounded summary so the Overview tab hydrates instantly next time
      // (any device, any signed-in role) without re-billing the model. Written via the
      // Admin SDK to a server-only collection — the client reads it but never writes it.
      // A write failure must never fail the request: the caller still gets the summary.
      const productId = req.data?.productId
      if (productId) {
        try {
          await getFirestore().doc(`productSummaries/${productId}`).set({
            ...summary,
            productName:  p.name,
            metaHash:     req.data?.metaHash ?? null,
            basisFormNumber: p.baseForm?.number ?? null,
            generatedAt:  FieldValue.serverTimestamp(),
            generatedBy:  req.auth.uid,
            model:        MODEL_FAST,
          }, { merge: false })
        } catch (persistErr) {
          console.warn('[summarizeProduct] persist failed (non-fatal):', persistErr)
        }
      }
      return summary
    } catch (err) {
      ok = false
      throw err
    } finally {
      void recordUsage({ feature: 'summarizeProduct', model: MODEL_FAST, usage: usageAccum, latencyMs: Date.now() - t0, ok, sessionKey })
    }
  },
)
