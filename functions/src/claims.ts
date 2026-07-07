// claims.ts — the grounded "coverage copilot". A claims professional uploads a
// Homeowners base coverage form, then converses about a real-world loss. Two
// Functions, both AI-only server-side:
//   • analyzeClaim   — multi-turn SSE conversation. Reads the ACTUAL uploaded PDF
//     (base64 `document` block, cached across turns) plus the product's structured
//     data via the grounding TOOLS, and reuses runChatAgent (the single agent loop).
//     Determinations stream as prose AND as a structured `emit_determination` tool
//     call that we surface as a `json` event so the UI renders a deterministic card.
//   • identifyBaseForm — a one-shot callable (EDITOR/ADMIN) that reads a freshly
//     uploaded form and returns its title / form number / edition for the library card.
// Writes NOTHING to domain data. AWS-SWAP: onRequest/onCall → Lambda URLs; auth +
// secret handling live in runtime.ts.
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https'
import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, authenticate, AuthError, MODEL, openSse, send, ANTHROPIC_API_KEY } from './runtime'
import { runChatAgent } from './ai'
import { TOOLS, runTool } from './tools'
import type { ToolOutput } from './tools'

// ─── Structured determination (the card contract) ──────────────────────────────
// The model calls this exactly once, as its final action, when the user has
// described a loss and wants a coverage determination. Its input is the payload the
// UI renders as the determination card, so the shape mirrors the card sections.
const EMIT_DETERMINATION_TOOL: Anthropic.Tool = {
  name: 'emit_determination',
  description:
    'Record your coverage determination for a described loss. Call this exactly once, ' +
    'as your FINAL action, only after you have gathered every fact you need from the ' +
    'other tools. Do not call it alongside other tools. Ground every field in the ' +
    "uploaded form's language and the product data — never invent a coverage, limit or " +
    'exclusion. When a figure depends on the insured\'s Declarations or an adjuster, say ' +
    'so in the value/note rather than guessing a number.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: {
        type: 'string',
        enum: ['COVERED', 'NOT_COVERED', 'PARTIAL'],
        description: 'COVERED, NOT_COVERED, or PARTIAL (partially covered / depends on a policy option or fact).',
      },
      summary: { type: 'string', description: 'One plain-English sentence stating the outcome.' },
      coverages: {
        type: 'array',
        description: 'The specific coverages and endorsements that apply. Empty if none apply.',
        items: {
          type: 'object',
          properties: {
            name:       { type: 'string', description: 'Coverage/endorsement name, e.g. "Coverage A — Dwelling".' },
            refId:      { type: 'string', description: 'Coverage refId if known, e.g. HO.COV.001.' },
            formNumber: { type: 'string', description: 'Endorsement form number if applicable, e.g. HO 04 95.' },
            definition: { type: 'string', description: 'One concise sentence: what this coverage does, grounded in the form.' },
          },
          required: ['name', 'definition'],
        },
      },
      limits: {
        type: 'array',
        description: 'Relevant limits, sub-limits and deductibles. Use an honest value when it is set by the Declarations.',
        items: {
          type: 'object',
          properties: {
            label:  { type: 'string', description: 'What the figure is, e.g. "All-peril deductible" or "Water back-up sub-limit".' },
            value:  { type: 'string', description: 'The figure, e.g. "$1,000", "10% of Coverage A", or "Per the Declarations".' },
            source: { type: 'string', description: 'A single source it comes from: one refId (HO.LD.003), one form number, or "Declarations".' },
            note:   { type: 'string', description: 'Optional caveat, e.g. "coastal states only; must be ≥ the all-peril deductible".' },
          },
          required: ['label', 'value'],
        },
      },
      reasoning: {
        type: 'array',
        description: '2–4 tight sentences explaining the determination, each citing the decisive coverage/rule/exclusion in [brackets]. Name the decisive exclusion when NOT_COVERED.',
        items: { type: 'string' },
      },
      openItems: {
        type: 'array',
        description: 'The key items the form does not determine — facts needing the Declarations page or an adjuster. Usually 2–4, most important first. Empty if none.',
        items: { type: 'string' },
      },
      citations: {
        type: 'array',
        description: 'Every refId / form number relied on, e.g. ["HO.COV.001","HO 00 03","HO.LD.003"].',
        items: { type: 'string' },
      },
      formNumber: { type: 'string', description: 'Always set: the base form number the analysis is grounded in, e.g. HO 00 03.' },
    },
    required: ['verdict', 'summary', 'coverages', 'limits', 'reasoning'],
  },
}

const CLAIMS_TOOLS: Anthropic.Tool[] = [...TOOLS, EMIT_DETERMINATION_TOOL]

// Claims-specific context layered on top of the house grounding rules (SYSTEM_PROMPT).
const CLAIMS_SYSTEM = `You are a senior P&C claims coverage analyst working a Homeowners file. Attached to this conversation is the actual base coverage form the policy is written on — read ITS language (agreement, Section I property coverages & perils, Section I exclusions, Section II liability, conditions) as the primary authority. The product's structured data (coverages, endorsements, limits, deductibles, rules, rating) is in Firestore and reachable through the grounding tools; the seeded product is the ISO-style Homeowners HO-3 (omit productId to use the sole product).

YOUR JOB when the claims professional describes a loss and asks about coverage:
1. Decide COVERED, NOT_COVERED, or PARTIAL (partially covered / depends on a policy option or fact).
2. Identify the exact coverages and endorsements that apply, each with a concise definition drawn from the form.
3. State the limits, sub-limits and deductibles that apply, with their source. If a figure is set by the insured's Declarations (e.g. the Coverage A amount, the selected deductible), say so — do NOT invent a number.
4. Give concise, cited reasoning that names the decisive coverage OR exclusion. HO-3 insures Coverages A & B against risk of direct physical loss (open peril) subject to the Section I exclusions, and Coverage C on the named perils. Sudden & accidental water discharge is covered; constant/repeated seepage, gradual leakage, wear & tear, and mold/fungus/wet rot are excluded; water that backs up through sewers/drains or a sump is excluded under the base form unless the Water Back-Up endorsement (HO 04 95) is on the policy; flood/surface water is excluded.
5. Explicitly flag anything the form does not determine (facts needing the Declarations page or an adjuster's inspection).

Then call emit_determination exactly once, as your final action, with the structured result (always set its formNumber to the base form's number). That structured determination is the primary answer.

For questions that are NOT a loss determination (a definition, a limit/deductible lookup, a follow-up that refines a prior scenario), answer concisely in cited prose and do NOT call emit_determination — unless the refinement changes a prior verdict, in which case re-issue the determination.

WORKING STYLE — important:
- Use tools SILENTLY first. Do not write any prose until you have finished gathering facts. Never describe your process, your plan, or which tool you are about to use, and never mention the tools or "emit_determination" in the text you output — the claims professional sees only your final answer. Lead with the answer. Do not preface a prose answer by classifying the question or saying a determination isn't needed — just give the answer.
- There are two seeded products (the Homeowners HO-3 and a General Liability line); this analysis is always the HO-3. get_coverage and get_ld_table take a refId and need no productId — prefer them; use search_entities to resolve the HO-3 product before get_rules or get_product_tree.
- Ground every specific coverage, limit, sub-limit, deductible, rule or exclusion in the form's text and/or a tool result, and cite the refId or form number in [brackets]. Never fabricate. If the form is silent or a fact is unknown, say so plainly.`

// ─── analyzeClaim — the multi-turn coverage conversation (SSE) ──────────────────

interface ClaimBody {
  messages?:   Array<{ role: string; content: string }>
  formBase64?: string
  formText?:   string
  mediaType?:  string
  formNumber?: string
}

export const analyzeClaim = onRequest(
  { secrets: [ANTHROPIC_API_KEY], cors: true, timeoutSeconds: 300, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

    // Any signed-in role may analyse — it only reads. Uploads are gated separately.
    try { await authenticate(req) }
    catch (e) { res.status(401).json({ error: e instanceof AuthError ? e.message : 'Unauthorized' }); return }

    openSse(res)
    try {
      const body     = (req.body ?? {}) as ClaimBody
      const incoming = (body.messages ?? []).filter(m => m.content?.trim())
      if (incoming.length === 0) { send(res, { t: 'error', message: 'No message provided.' }); return }
      if (!body.formBase64 && !body.formText?.trim()) {
        send(res, { t: 'error', message: 'Select a base form to analyse against.' }); return
      }

      // The uploaded policy rides on the first user turn as a cached document block,
      // so it is read once per request (and reused across turns within the cache TTL)
      // rather than re-sent on every history item.
      const formNumber = body.formNumber?.trim() || 'the base form'
      const messages: Anthropic.MessageParam[] = incoming.map((m, i) => {
        const role = m.role === 'assistant' ? 'assistant' : 'user'
        if (i === 0 && role === 'user') {
          const content: Anthropic.ContentBlockParam[] = []
          if (body.formBase64 && body.mediaType === 'application/pdf') {
            content.push({
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: body.formBase64 },
              cache_control: { type: 'ephemeral' },
            })
          } else if (body.formText?.trim()) {
            content.push({ type: 'text', text: `BASE COVERAGE FORM (${formNumber}):\n\n${body.formText.slice(0, 200_000)}`, cache_control: { type: 'ephemeral' } })
          }
          content.push({ type: 'text', text: m.content })
          return { role, content }
        }
        return { role, content: m.content }
      })

      // Custom executor: capture the structured determination and surface it as a
      // `json` event; delegate every grounding tool to the shared runTool.
      const runClaimsTool = (name: string, input: Record<string, unknown>): Promise<ToolOutput> => {
        if (name === 'emit_determination') {
          send(res, { t: 'json', key: 'determination', value: input })
          return Promise.resolve({ content: JSON.stringify({ recorded: true }), summary: 'determination ready' })
        }
        return runTool(name, input)
      }

      await runChatAgent(anthropic(), messages, res, {
        system:    CLAIMS_SYSTEM,
        tools:     CLAIMS_TOOLS,
        runTool:   runClaimsTool,
        maxTokens: 2600,
        maxTurns:  7,
      })
      send(res, { t: 'done' })
    } catch (err) {
      send(res, { t: 'error', message: err instanceof Error ? err.message : 'Analysis failed.' })
    } finally {
      res.end()
    }
  },
)

// ─── identifyBaseForm — one-shot metadata read for the library card ─────────────

interface IdentifyBody {
  formBase64?: string
  formText?:   string
  mediaType?:  string
  fileName?:   string
}

const IDENTIFY_TOOL: Anthropic.Tool = {
  name: 'identify_form',
  description:
    'Return the identifying header of this insurance form — read only what the document ' +
    'actually shows; leave a field blank if the form does not state it. Never invent a number.',
  input_schema: {
    type: 'object',
    properties: {
      title:      { type: 'string', description: 'The form title, e.g. "Homeowners 3 – Special Form".' },
      formNumber: { type: 'string', description: 'The form number exactly as printed, e.g. "HO 00 03".' },
      edition:    { type: 'string', description: 'The edition date as printed, e.g. "10 00".' },
    },
    required: ['title'],
  },
}

export const identifyBaseForm = onCall<IdentifyBody>(
  { secrets: [ANTHROPIC_API_KEY], maxInstances: 5, timeoutSeconds: 60, memory: '512MiB' },
  async (req) => {
    // Author-only: identifying a base form is part of the upload flow — guard like a mutation.
    const role = (req.auth?.token as { role?: string } | undefined)?.role
    if (role !== 'EDITOR' && role !== 'ADMIN') throw new HttpsError('permission-denied', 'Editor access required.')

    const body = req.data ?? {}
    const content: Anthropic.ContentBlockParam[] = []
    if (body.formBase64 && body.mediaType === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: body.formBase64 } })
    } else if (body.formText?.trim()) {
      content.push({ type: 'text', text: `INSURANCE FORM:\n\n${body.formText.slice(0, 40_000)}` })
    } else {
      throw new HttpsError('invalid-argument', 'No form content provided.')
    }
    content.push({ type: 'text', text: 'Identify this form, then call identify_form exactly once.' })

    const msg = await anthropic().messages.create({
      model:       MODEL,
      max_tokens:  400,
      system:      'You read the header of an uploaded P&C insurance form and report its title, form number and edition exactly as printed. Do not invent anything.',
      tools:       [IDENTIFY_TOOL],
      tool_choice: { type: 'tool', name: 'identify_form' },
      messages:    [{ role: 'user', content }],
    })
    const tu = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    const out = (tu?.input as { title?: string; formNumber?: string; edition?: string } | undefined) ?? {}
    return {
      title:      (out.title ?? body.fileName ?? 'Base form').trim(),
      formNumber: (out.formNumber ?? '').trim(),
      edition:    (out.edition ?? '').trim(),
    }
  },
)
