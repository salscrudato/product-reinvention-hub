// extract.ts — grounded coverage extraction from an uploaded base coverage form.
// The client sends the form's content (text, or a base64 PDF); Claude reads it and,
// via a single forced tool, proposes the product's coverages — each prefilled with
// its requirement / rated flag / attached form numbers, plus a confidence and a
// citation back to the form. Never invents coverages; lower confidence when the
// form is ambiguous. EDITOR/ADMIN only. Streamed over SSE (one json event).
// AWS-SWAP: onRequest → Lambda URL; auth + secret handling live in runtime.ts.
import { onRequest } from 'firebase-functions/v2/https'
import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, authenticate, AuthError, MODEL, openSse, send, ANTHROPIC_API_KEY } from './runtime'

interface ExtractBody {
  productName?: string
  formText?:    string
  formBase64?:  string
  mediaType?:   string
}

const PROPOSE_TOOL: Anthropic.Tool = {
  name: 'propose_coverages',
  description:
    'Return the coverages the base form actually defines. Only include coverages the ' +
    'document describes — never invent coverages, forms, limits or requirements. Use ' +
    'lower confidence when the form is ambiguous about a field.',
  input_schema: {
    type: 'object',
    properties: {
      coverages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name:              { type: 'string',  description: 'Coverage name exactly as the form uses it, e.g. "Coverage A — Dwelling".' },
            requirement:       { type: 'string',  enum: ['MANDATORY', 'OPTIONAL'] },
            premiumGenerating: { type: 'boolean', description: 'True if this coverage is rated (generates premium).' },
            formNumbers:       { type: 'array', items: { type: 'string' }, description: 'Attached ISO/proprietary form numbers, e.g. "HO 00 03".' },
            limitHint:         { type: 'string',  description: 'Short summary of the limit basis if the form states one, e.g. "10% of Coverage A".' },
            confidence:        { type: 'number',  description: '0..1 confidence this coverage is correctly identified.' },
            citation:          { type: 'string',  description: 'Where in the form this was found (section / heading / page).' },
          },
          required: ['name', 'requirement', 'premiumGenerating', 'confidence', 'citation'],
        },
      },
    },
    required: ['coverages'],
  },
}

const SYSTEM =
  'You are a P&C insurance product analyst. Read the provided base coverage form and ' +
  'identify the coverages it defines for the product. Ground every proposal in the ' +
  "form's actual text — do not invent coverages, forms, limits or requirements. Prefer " +
  'the exact coverage names and ISO form numbers used in the document. When the form is ' +
  'ambiguous about a field, lower the confidence. Call propose_coverages exactly once.'

export const extractCoverages = onRequest(
  { secrets: [ANTHROPIC_API_KEY], cors: true, timeoutSeconds: 120, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

    // Author-only: extraction proposes writes, so guard like a mutation.
    try {
      const caller = await authenticate(req)
      if (caller.role !== 'EDITOR' && caller.role !== 'ADMIN') {
        res.status(403).json({ error: 'Editor access required.' }); return
      }
    } catch (e) {
      res.status(401).json({ error: e instanceof AuthError ? e.message : 'Unauthorized' }); return
    }

    openSse(res)
    try {
      const body = (req.body ?? {}) as ExtractBody
      const content: Anthropic.ContentBlockParam[] = []

      if (body.formBase64 && body.mediaType === 'application/pdf') {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: body.formBase64 } })
      } else if (body.formText?.trim()) {
        content.push({ type: 'text', text: `BASE COVERAGE FORM:\n\n${body.formText.slice(0, 120_000)}` })
      } else {
        send(res, { t: 'error', message: 'No form content provided.' }); return
      }
      content.push({ type: 'text', text: `Product: ${body.productName ?? 'this product'}. Identify every coverage this form defines, then call propose_coverages.` })

      send(res, { t: 'tool', name: 'read_base_form', phase: 'start' })
      const msg = await anthropic().messages.create({
        model:       MODEL,
        max_tokens:  3000,
        system:      SYSTEM,
        tools:       [PROPOSE_TOOL],
        tool_choice: { type: 'tool', name: 'propose_coverages' },
        messages:    [{ role: 'user', content }],
      })

      const tu = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      const proposal = (tu?.input as { coverages?: unknown[] } | undefined) ?? { coverages: [] }
      const count = Array.isArray(proposal.coverages) ? proposal.coverages.length : 0
      send(res, { t: 'tool', name: 'read_base_form', phase: 'end', summary: `${count} coverage${count === 1 ? '' : 's'} found` })
      send(res, { t: 'json', key: 'proposal', value: proposal })
      send(res, { t: 'done' })
    } catch (err) {
      send(res, { t: 'error', message: err instanceof Error ? err.message : 'Extraction failed.' })
    } finally {
      res.end()
    }
  },
)
