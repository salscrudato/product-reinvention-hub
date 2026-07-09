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
import { getApps, initializeApp } from 'firebase-admin/app'
import { getStorage } from 'firebase-admin/storage'
import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, authenticate, AuthError, MODEL, MODEL_FAST, openSse, send, ANTHROPIC_API_KEY, VOYAGE_API_KEY, voyageKey, CACHE_1H } from './runtime'

if (!getApps().length) initializeApp()
import { runChatAgent, assistantText, sseCostGate } from './ai'
import { TOOLS, runTool } from './tools'
import type { ToolOutput } from './tools'
import { emptyUsage, addUsage, recordUsage, recordCascade } from './telemetry'
import type { ChunkMetadata } from '@pf/shared'
import { retrieve } from './retrieval/index'
import { buildCiteableDocuments, citationsFromConvo, verifyCitations } from './retrieval/citations'

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
    'so in the value/note rather than guessing a number. Every reasoning point must cite, ' +
    'in [brackets], the form section/clause and/or the refId or form number it relied on; ' +
    'a substantive determination that cites nothing will be rejected.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: {
        type: 'string',
        enum: ['COVERED', 'NOT_COVERED', 'PARTIAL', 'NOT_ADDRESSED'],
        description: 'COVERED; NOT_COVERED; PARTIAL (partially covered / depends on a policy option or fact); or NOT_ADDRESSED (the attached form does not address this scenario — it is silent, or the scenario is outside what this line/form covers). Use NOT_ADDRESSED honestly rather than forcing a verdict or inventing coverage.',
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
      exclusions: {
        type: 'array',
        description: 'The specific exclusions, limitations or carve-outs that shaped the verdict — what is NOT covered and why (e.g. the failed pipe/appliance itself, gradual/repeated seepage, mold/fungus conditions, or the decisive Coverage A/B or Section I exclusion). Empty if none are relevant. Cite each in source (a form section, refId or form number).',
        items: {
          type: 'object',
          properties: {
            name:       { type: 'string', description: 'The excluded item or named exclusion, e.g. "The failed pipe itself" or "Water Damage exclusion".' },
            refId:      { type: 'string', description: 'Rule/coverage refId if applicable, e.g. HO.RU.006.' },
            formNumber: { type: 'string', description: 'The form number or form section it comes from, e.g. "HO 00 03 §I.B.12.b(1)" or "CG 00 01 Excl. j".' },
            note:       { type: 'string', description: 'One concise sentence: what is excluded / carved out and how it bears on this loss.' },
          },
          required: ['name'],
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
        description: 'Every specific source relied on — a form section/clause and/or a refId or form number, e.g. ["Section I – Exclusions","HO.COV.001","HO 04 95"] or ["Coverage A – Bodily Injury","GL.COV.002","CG 00 01"]. For a substantive verdict this must be non-empty; may be empty only for NOT_ADDRESSED.',
        items: { type: 'string' },
      },
      formNumber: { type: 'string', description: 'Always set: the base form number the analysis is grounded in, e.g. HO 00 03 or CG 00 01.' },
    },
    required: ['verdict', 'summary', 'coverages', 'limits', 'reasoning', 'citations'],
  },
}

const CLAIMS_TOOLS: Anthropic.Tool[] = [...TOOLS, EMIT_DETERMINATION_TOOL]

// Claims-specific context layered on top of the house grounding rules (SYSTEM_PROMPT).
// Line-agnostic: the ATTACHED form is authoritative and tells the model the line, so the
// same copilot works for a Homeowners HO-3 or an ISO Personal Auto Policy (PAP PP 00 01).
// The per-line framing below is applied to whichever line the attached form belongs to.
const CLAIMS_SYSTEM = `You are a senior P&C claims coverage analyst. Attached to this conversation is the ACTUAL base coverage form the policy is written on — read ITS language (insuring agreement, the coverages and their triggers/perils, exclusions, conditions and definitions) as the PRIMARY authority. The form itself identifies the line: an ISO-style Homeowners form (e.g. HO 00 03) or an ISO Personal Auto Policy form (e.g. PP 00 01).

RESOLVE THE RIGHT PRODUCT. The portfolio holds two products: a Personal Home Policy (ISO Homeowners HO-3 style) and a Personal Auto Policy (ISO PAP PP 00 01 style). Use search_entities to find the product that MATCHES the attached form's line, then pass its productId to get_rules and get_product_tree so you never mix lines. get_coverage, get_ld_table and get_dictionary take a refId and need no productId — prefer them.

YOUR JOB when a loss or claim scenario is described:
1. Decide COVERED, NOT_COVERED, PARTIAL (depends on a policy option or fact), or NOT_ADDRESSED (the attached form does not address this scenario — it is silent, or the scenario is outside what this line/form covers). Use NOT_ADDRESSED honestly instead of forcing a verdict or inventing coverage.
2. Identify the exact coverages and endorsements that apply, each with a concise definition drawn from the form.
3. Name the specific exclusions and carve-outs that shape the verdict — what is NOT covered and why (e.g. the failed pipe/appliance itself, gradual or repeated seepage, mold/fungus, or the decisive Coverage A/B or Section I exclusion). Populate the determination's exclusions with these, each cited; note when a plausible exclusion does NOT apply.
4. State the limits, sub-limits and deductibles that apply, with their source. If a figure is set by the insured's Declarations (e.g. the Coverage A amount, the selected occurrence limit or deductible), say so — do NOT invent a number.
5. Give concise, cited reasoning that names the decisive coverage OR exclusion.
6. Explicitly flag anything the form does not determine (facts needing the Declarations page or an adjuster's inspection).

Then call emit_determination exactly once, as your final action, with the structured result (always set its formNumber to the base form's number). CITE EVERYTHING: every reasoning point must cite, in [square brackets], the specific form section/clause you read (e.g. [Section I – Exclusions], [Coverage A – Dwelling], [Coverage A – Bodily Injury]) and/or the refId or form number from a tool (e.g. [HO.COV.001], [HO 04 95], [GL.COV.002], [CG 00 01]). A substantive determination that cites nothing will be rejected — cite or answer NOT_ADDRESSED. Never fabricate a coverage, limit, exclusion or form.

LINE FRAMING — apply the one matching the attached form:
• Homeowners (HO-3 / PP 00 03): first-party property + liability. Coverages A & B (dwelling / other structures) are insured against risk of direct physical loss on an OPEN-peril basis subject to the Section I exclusions; Coverage C (personal property) on the NAMED perils; plus D–F (loss of use, personal liability, medical payments). Sudden & accidental water discharge is covered; constant/repeated seepage, gradual leakage, wear & tear and mold/fungus/wet rot are excluded; water backing up through sewers/drains or a sump is excluded under the base form unless the Water Back-Up endorsement (HO 04 95) is on the policy; flood/surface water is excluded.
• Personal Auto (PP 00 01): the ISO Personal Auto Policy (PAP). Four parts: A — Liability (bodily injury and property damage the insured is legally obligated to pay to others); B — Medical Payments (reasonable medical expenses for the insured regardless of fault); C — Uninsured/Underinsured Motorists; D — Coverage for Damage to Your Auto (Collision on an actual-cash-value basis; Other Than Collision / Comprehensive for theft, weather, animal strikes, etc.). Subject to the standard exclusions (wear & tear, mechanical breakdown, nuclear, intentional damage, racing, business use, resident-relative exclusions). A non-vehicle bodily injury that is NOT auto-related is NOT a PAP subject — answer NOT_ADDRESSED. Confirm the specific Part (A/B/C/D) that applies before calling emit_determination.

For questions that are NOT a loss determination (a definition, a limit/deductible lookup, a follow-up that refines a prior scenario), answer concisely in cited prose and do NOT call emit_determination — unless the refinement changes a prior verdict, in which case re-issue the determination.

WORKING STYLE — important:
- Use tools SILENTLY first. Do not write any prose until you have finished gathering facts. Never describe your process, your plan, or which tool you are about to use, and never mention the tools or "emit_determination" in the text you output — the claims professional sees only your final answer. Lead with the answer. Do not preface a prose answer by classifying the question or saying a determination isn't needed — just give the answer.
- Ground every specific coverage, limit, sub-limit, deductible, rule or exclusion in the form's text and/or a tool result, and cite the refId or form number in [brackets]. Never fabricate. If the form is silent or a fact is unknown, say so plainly.`

// ─── Citation guard — the "grounded + cited" invariant, enforced server-side ────
// A substantive verdict (COVERED / NOT_COVERED / PARTIAL) may never reach the card
// without pointing at a real source: an explicit citation, a coverage refId / form
// number, a limit source, or a [bracketed] reasoning cite. The always-present base
// formNumber footer does NOT count on its own. NOT_ADDRESSED is the honest exception
// (the form is silent — nothing to cite). Mirror of app/src/lib/claims/determination.ts.
const SUBSTANTIVE_VERDICTS = new Set(['COVERED', 'NOT_COVERED', 'PARTIAL'])

function determinationIsCited(d: Record<string, unknown>): boolean {
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
  const explicit  = arr(d.citations).some(c => str(c).length > 0)
  const coverage  = arr(d.coverages).some(c => { const o = c as Record<string, unknown>; return str(o.refId) || str(o.formNumber) })
  const exclusion = arr(d.exclusions).some(e => { const o = e as Record<string, unknown>; return str(o.refId) || str(o.formNumber) })
  const limit     = arr(d.limits).some(l => str((l as Record<string, unknown>).source).length > 0)
  const reasoning = arr(d.reasoning).some(r => /\[[^\]]+\]/.test(str(r)))
  return explicit || coverage || exclusion || limit || reasoning
}

// ─── analyzeClaim — the multi-turn coverage conversation (SSE) ──────────────────

interface ClaimBody {
  messages?:            Array<{ role: string; content: string }>
  // New fast path: browser sends only the Storage path; the function fetches server-side.
  // Legacy base64/text paths kept for backward compat but should not be used by new clients.
  formStoragePath?:      string
  formStorageMediaType?: string
  formBase64?:           string
  formText?:             string
  mediaType?:            string
  formNumber?:           string
  lob?:                  string
  sessionId?:            string
}

// Fetches the policy form from Firebase Storage (same GCP network — very fast).
// Returns `formBase64` for PDFs or `formText` for plain-text forms, ready to
// attach to the Anthropic document block exactly as the legacy client path did.
async function fetchFormContent(storagePath: string, mediaType: string): Promise<{ formBase64?: string; formText?: string; mediaType: string }> {
  const [buf] = await getStorage().bucket().file(storagePath).download()
  if (mediaType === 'application/pdf') {
    return { formBase64: (buf as Buffer).toString('base64'), mediaType }
  }
  return { formText: (buf as Buffer).toString('utf-8'), mediaType }
}

// Human labels for the detected line, used to nudge the model toward the right product.
const LINE_LABELS: Record<string, string> = {
  HO: 'an ISO Homeowners form',
  GL: 'a Commercial General Liability form',
  PA: 'an ISO Personal Auto Policy form',
}

export const analyzeClaim = onRequest(
  { secrets: [ANTHROPIC_API_KEY, VOYAGE_API_KEY], cors: true, timeoutSeconds: 300, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

    // Any signed-in role may analyse — it only reads. Uploads are gated separately.
    let caller
    try { caller = await authenticate(req) }
    catch (e) { res.status(401).json({ error: e instanceof AuthError ? e.message : 'Unauthorized' }); return }

    openSse(res)
    const usageAccum = emptyUsage()
    const t0 = Date.now()
    let ok = true
    let providerCalled = true
    let degraded = false
    let denied = false
    const body       = (req.body ?? {}) as ClaimBody
    const sessionKey = body.sessionId?.trim() || caller.uid
    try {
      const incoming = (body.messages ?? []).filter(m => m.content?.trim())
      if (incoming.length === 0) { send(res, { t: 'error', message: 'No message provided.' }); return }
      if (!body.formStoragePath?.trim() && !body.formBase64 && !body.formText?.trim()) {
        send(res, { t: 'error', message: 'No form document was attached to this request. If you selected a form, remove it from the library and re-upload it.' }); return
      }

      // Resolve form content. Prefer the Storage path (fast server-side download) over
      // the legacy base64/text paths. For the Storage path we fetch once here and reuse
      // across all turns; the document block's prompt-cache handles cross-turn reuse.
      let resolvedBase64  = body.formBase64
      let resolvedText    = body.formText
      let resolvedMedia   = body.mediaType ?? 'application/pdf'
      if (body.formStoragePath?.trim()) {
        const fetched = await fetchFormContent(body.formStoragePath.trim(), body.formStorageMediaType ?? 'application/pdf')
        resolvedBase64 = fetched.formBase64
        resolvedText   = fetched.formText
        resolvedMedia  = fetched.mediaType
      }

      // Part C — cost cap + breaker gate. A hard/breaker block streams a notice + done here.
      const gate = await sseCostGate(res, 'analyzeClaim', sessionKey)
      if (!gate.proceed) { providerCalled = false; denied = gate.blocked === 'deny'; degraded = gate.blocked === 'breaker'; return }
      degraded = gate.degraded

      // The uploaded policy rides on the first user turn as a cached document block,
      // so it is read once per request (and reused across turns within the cache TTL)
      // rather than re-sent on every history item.
      const formNumber = body.formNumber?.trim() || 'the base form'
      // The uploaded form is ALWAYS the first citeable document (index 0). Its citations
      // resolve to the base form itself (char/page-level cited_text into the real clause).
      const formMeta: ChunkMetadata = {
        type: 'baseForm', refId: null, formNumber: body.formNumber?.trim() || null, productId: null,
        path: body.formNumber ? `forms/${body.formNumber.trim().replace(/\s+/g, '-')}` : '', title: formNumber,
      }

      // Additional citeable structured chunks for the described scenario (gated on a Voyage
      // key). These add refId-level product data the model can cite alongside the form; the
      // parallel citationIndex maps each returned citation back to a verifiable anchor.
      let chunkBlocks: Anthropic.DocumentBlockParam[] = []
      const citationIndex: ChunkMetadata[] = [formMeta]
      const vKey = voyageKey()
      // Under a soft budget cap, skip the extra citation augmentation (the uploaded form stays
      // the authoritative citeable source) to cut input tokens; grounding stays enforced.
      if (vKey && !degraded && incoming[0]?.content) {
        try {
          const built = buildCiteableDocuments(await retrieve({ query: incoming[0].content, topK: 5, voyageKey: vKey }))
          chunkBlocks = built.blocks
          citationIndex.push(...built.index)   // documents order: [form, ...chunks]
        } catch (e) { console.warn('[analyzeClaim] citation pre-retrieval skipped:', e) }
      }

      const messages: Anthropic.MessageParam[] = incoming.map((m, i) => {
        const role = m.role === 'assistant' ? 'assistant' : 'user'
        if (i === 0 && role === 'user') {
          const content: Anthropic.ContentBlockParam[] = []
          if (resolvedBase64 && resolvedMedia === 'application/pdf') {
            content.push({
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: resolvedBase64 },
              title: formNumber, citations: { enabled: true }, cache_control: CACHE_1H,
            })
          } else if (resolvedText?.trim()) {
            content.push({
              type: 'document',
              source: { type: 'text', media_type: 'text/plain', data: resolvedText.slice(0, 200_000) },
              title: `BASE COVERAGE FORM (${formNumber})`, citations: { enabled: true }, cache_control: CACHE_1H,
            })
          }
          for (const b of chunkBlocks) content.push(b)
          content.push({ type: 'text', text: m.content })
          return { role, content }
        }
        return { role, content: m.content }
      })

      // Custom executor: capture the structured determination and surface it as a
      // `json` event; delegate every grounding tool to the shared runTool.
      let determinationEmitted = false
      const runClaimsTool = (name: string, input: Record<string, unknown>): Promise<ToolOutput> => {
        if (name === 'emit_determination') {
          // Grounding invariant, enforced here: a substantive determination that cites
          // nothing is a bug — hand it back so the model re-issues it citing the section /
          // refId it relied on (or switches to NOT_ADDRESSED if the form is truly silent).
          // We never surface an uncited coverage determination to the UI.
          const verdict = typeof input.verdict === 'string' ? input.verdict : ''
          if (SUBSTANTIVE_VERDICTS.has(verdict) && !determinationIsCited(input)) {
            return Promise.resolve({
              content: JSON.stringify({
                error: 'This determination cites no source. Re-call emit_determination and cite, in [brackets] on each reasoning point, the specific form section/clause, coverage refId or form number you relied on. If the attached form does not actually address this scenario, set verdict to NOT_ADDRESSED instead of guessing.',
              }),
              summary: 'needs citation',
            })
          }
          send(res, { t: 'json', key: 'determination', value: input })
          determinationEmitted = true
          return Promise.resolve({ content: JSON.stringify({ recorded: true }), summary: 'determination ready' })
        }
        return runTool(name, input)
      }

      // The detected line is a hint only — the attached form remains authoritative.
      const lob = (body.lob ?? '').toUpperCase()
      const lobHint = LINE_LABELS[lob]
        ? `The attached form has been identified as ${LINE_LABELS[lob]} — analyze on that line and resolve the matching product.`
        : ''

      const convo = await runChatAgent(anthropic(), messages, res, {
        system:      CLAIMS_SYSTEM,
        context:     lobHint || undefined,
        tools:       CLAIMS_TOOLS,
        runTool:     runClaimsTool,
        maxTokens:   2600,
        maxTurns:    degraded ? 5 : 7,   // cost-saver: fewer tool turns under a soft cap
        usageAccum,
      })

      // B2: the loop can end (maxTurns exhausted, or a determination repeatedly rejected
      // for missing citations) having produced NEITHER a determination card NOR any prose
      // — a silent empty result. Never leave the copilot blank: emit a terminal message so
      // the user knows to add detail. A valid prose answer (a definition / follow-up) has
      // text, so this fires ONLY on the truly-empty case.
      if (!determinationEmitted && !assistantText(convo).trim()) {
        send(res, { t: 'error', message: "I couldn't reach a grounded determination for that scenario. Add detail about what happened and what was damaged, or rephrase, and I'll try again." })
      }

      // Resolve the model's Citations-API citations back to the supplied documents (the base
      // form + retrieved chunks): each valid citation points at a real, known source. An
      // out-of-set citation index (`invalid`) is an anomaly worth surfacing.
      const cv = verifyCitations(citationsFromConvo(convo), citationIndex)
      if (cv.invalid > 0) {
        send(res, { t: 'notice', level: 'warn', message: `${cv.invalid} citation${cv.invalid === 1 ? '' : 's'} referenced a source outside the grounded set — treat as unconfirmed.` })
      }
      send(res, { t: 'done' })
    } catch (err) {
      ok = false
      console.error('[analyzeClaim] internal error:', err)
      send(res, { t: 'error', message: 'Analysis failed.' })
    } finally {
      res.end()
      void recordUsage({ feature: 'analyzeClaim', model: MODEL, usage: usageAccum, latencyMs: Date.now() - t0, ok, sessionKey, degraded, denied, providerCalled })
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
      lob:        { type: 'string', enum: ['HO', 'PA', 'GL', 'OTHER'], description: 'The insurance line, inferred from the form itself: HO for an ISO Homeowners form, PA for an ISO Personal Auto Policy (PP 00 01), GL for a Commercial General Liability form, otherwise OTHER.' },
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

    // Reading a form's header (title / number / edition / line) is a CLASSIFICATION +
    // extraction first-pass — exactly what the fast model handles well. Run haiku FIRST,
    // then escalate to the reasoning model ONLY when a cheap check fails. The result is
    // metadata for a library card the author reviews and edits — never a grounded answer
    // presented as fact — so a cheap first pass carries no quality-floor risk.
    const run = (model: string) => anthropic().messages.create({
      model,
      max_tokens:  400,
      system:      'You read the header of an uploaded P&C insurance form and report its title, form number, edition and line (HO/PA/GL/OTHER) exactly as the document shows. Do not invent anything.',
      tools:       [IDENTIFY_TOOL],
      tool_choice: { type: 'tool', name: 'identify_form' },
      messages:    [{ role: 'user', content }],
    }, { timeout: 45_000 })
    const readIdentity = (msg: Anthropic.Message) => {
      const tu  = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      const raw = (tu?.input as { title?: string; formNumber?: string; edition?: string; lob?: string } | undefined) ?? {}
      const lob = (raw.lob ?? '').trim().toUpperCase()
      return {
        title:      (raw.title ?? body.fileName ?? 'Base form').trim(),
        formNumber: (raw.formNumber ?? '').trim(),
        edition:    (raw.edition ?? '').trim(),
        lob:        lob === 'HO' || lob === 'PA' || lob === 'GL' ? lob : '',
      }
    }

    const t0 = Date.now()
    let ok = true
    let escalated = false
    let tCheap = t0
    const cheapUsage  = emptyUsage()
    const strongUsage = emptyUsage()
    try {
      const cheapMsg = await run(MODEL_FAST)
      addUsage(cheapUsage, cheapMsg.usage)
      tCheap = Date.now()
      let out = readIdentity(cheapMsg)

      // CHECK — escalate only on a failed check: a confident read yields EITHER a printed
      // form number OR a recognized line (HO/GL). If the fast pass produced neither, the
      // header was hard to read — escalate to the reasoning model for an accurate identity.
      if (!out.formNumber && !out.lob) {
        escalated = true
        const strongMsg = await run(MODEL)
        addUsage(strongUsage, strongMsg.usage)
        out = readIdentity(strongMsg)
      }
      return out
    } catch (err) {
      ok = false
      throw err
    } finally {
      void recordCascade({
        feature: 'identifyBaseForm', cheapUsage, cheapLatencyMs: tCheap - t0, ok,
        strongUsage:     escalated ? strongUsage : undefined,
        strongLatencyMs: escalated ? Date.now() - tCheap : undefined,
      })
    }
  },
)
