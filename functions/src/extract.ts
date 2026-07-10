// extract.ts — grounded structured extraction from an uploaded base coverage form.
// The client sends the form's content (text, or a base64 PDF); Claude reads it and,
// via FOUR forced tools (one per section), proposes the product's:
//   • coverages     — name / requirement / rated flag / attached form numbers
//   • forms         — the form itself + the endorsements/exclusions it references
//   • rules         — PRODUCT (eligibility/limits/constraints) and FORMS (attachment) IF→THEN
//   • rating hints  — premium basis / factors / deductible bases / minimum premium
// Each proposal carries a 0..1 confidence and a citation to where in the document it
// was found. The model NEVER invents: the tools have no refId field (refIds are
// allocated by the app, so a fabricated one is impossible), and the shared sanitizers
// drop any proposal without a citation and any form number not present in the text.
// When a section yields nothing the sanitizer emits an explicit note. EDITOR/ADMIN
// only. Streamed over SSE: a tool start/end per section + one json event per section.
// AWS-SWAP: onRequest → Lambda URL; auth + secret handling live in runtime.ts.
import { onRequest } from 'firebase-functions/v2/https'
import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, authenticate, AuthError, MODEL, MODEL_FAST, openSse, send, ANTHROPIC_API_KEY, CACHE_1H } from './runtime'
import { extractPdfText } from './pdfText'
import {
  cleanCoverages, cleanForms, cleanRules, cleanRating,
  type ExtractionSection, type ExtractionResult,
} from '@pf/shared'
import { emptyUsage, addUsage, recordCascade, recordUsage } from './telemetry'
import type { UsageAccum } from './telemetry'
import { sseCostGate } from './ai'

interface ExtractBody {
  productName?: string
  formText?:    string
  formBase64?:  string
  mediaType?:   string
  sessionId?:   string   // per-session cost-cap bucket
}

// ─── Forced tools — one per section. Each item requires confidence + citation. ──
// Shared field fragments keep the "confidence + citation" contract identical across
// tools, so every proposal — of every kind — is cited by construction.
const CONFIDENCE = { type: 'number',  description: '0..1 confidence this item is correctly identified from the document. Lower it when the form is ambiguous.' } as const
const CITATION   = { type: 'string',  description: 'Where in the document this was found (section / heading / page). REQUIRED — proposals without a citation are discarded.' } as const

const PROPOSE_COVERAGES: Anthropic.Tool = {
  name: 'propose_coverages',
  description:
    'Return the coverages the base form actually defines. Only include coverages the ' +
    'document describes — never invent a coverage, form, limit or requirement.',
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
            formNumbers:       { type: 'array', items: { type: 'string' }, description: 'Attached ISO/proprietary form numbers exactly as printed, e.g. "HO 00 03". Only numbers that appear in the document.' },
            limitHint:         { type: 'string',  description: 'Short summary of the limit basis if the form states one, e.g. "10% of Coverage A".' },
            confidence:        CONFIDENCE,
            citation:          CITATION,
          },
          required: ['name', 'requirement', 'premiumGenerating', 'confidence', 'citation'],
        },
      },
      note: { type: 'string', description: 'If the document defines no coverages, return an empty array and explain here.' },
    },
    required: ['coverages'],
  },
}

const PROPOSE_FORMS: Anthropic.Tool = {
  name: 'propose_forms',
  description:
    'Return the insurance forms this document IS or explicitly references BY NUMBER — the base ' +
    'form itself, plus any declarations, endorsements, exclusions or amendatory forms it names. ' +
    'Only include a form whose number literally appears in the document. Never invent a form number.',
  input_schema: {
    type: 'object',
    properties: {
      forms: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            number:              { type: 'string', description: 'Form number exactly as printed, e.g. "HO 00 03" or "CG 00 01".' },
            name:                { type: 'string', description: 'The form title as the document states it.' },
            edition:             { type: 'string', description: 'Edition date as printed, e.g. "05 11", if shown.' },
            category:            { type: 'string', enum: ['BASE_COVERAGE', 'DECLARATIONS', 'ENDORSEMENT', 'EXCLUSION', 'AMENDATORY', 'POLICY_NOTICE'] },
            mandatoryDefault:    { type: 'boolean', description: 'True if the form is always attached (not optional/rule-driven).' },
            attachmentCondition: { type: 'string', enum: ['RULE', 'NONE'], description: 'NONE = always attached; RULE = attaches only when a condition is met.' },
            confidence:          CONFIDENCE,
            citation:            CITATION,
          },
          required: ['number', 'category', 'confidence', 'citation'],
        },
      },
      note: { type: 'string', description: 'If the document references no forms beyond itself, say so here.' },
    },
    required: ['forms'],
  },
}

const PROPOSE_RULES: Anthropic.Tool = {
  name: 'propose_rules',
  description:
    'Return the product rules the document\'s language supports, as short IF → THEN statements. ' +
    'Use PRODUCT for eligibility, coverage limits/constraints and packaging; FORMS for "attach ' +
    'endorsement X when Y". Reference coverages by the NAME the form uses and forms by number — ' +
    'never emit an internal id. Do NOT include rating/premium rules here (use propose_rating).',
  input_schema: {
    type: 'object',
    properties: {
      rules: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            category:      { type: 'string', enum: ['PRODUCT', 'FORMS'] },
            subCategory:   { type: 'string', description: 'e.g. "Eligibility", "Coverage Limits", "Coverage Constraints", "Attachment".' },
            condition:     { type: 'string', description: 'The IF clause — short and declarative, e.g. "Water Back-Up elected".' },
            outcome:       { type: 'string', description: 'The THEN clause — what the rule requires, blocks or attaches, e.g. "Attach HO 04 95".' },
            coverageNames: { type: 'array', items: { type: 'string' }, description: 'Names of coverages this rule governs, exactly as the form writes them.' },
            formNumbers:   { type: 'array', items: { type: 'string' }, description: 'Form numbers the rule attaches/references — only numbers present in the document.' },
            confidence:    CONFIDENCE,
            citation:      CITATION,
          },
          required: ['category', 'condition', 'outcome', 'confidence', 'citation'],
        },
      },
      note: { type: 'string', description: 'If the document supports no such rules, say so here.' },
    },
    required: ['rules'],
  },
}

const PROPOSE_RATING: Anthropic.Tool = {
  name: 'propose_rating',
  description:
    'Return RATING hints the document explicitly states — the premium basis, rating variables, ' +
    'deductible bases, or a minimum premium. IMPORTANT: a base coverage form usually contains NO ' +
    'rating information (rates live in a separate rate manual). If so, return an empty array and ' +
    'say so in note. Never invent a rate, factor, table or number.',
  input_schema: {
    type: 'object',
    properties: {
      hints: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            subCategory:    { type: 'string', description: 'e.g. "Premium Basis", "Deductibles", "Premium Floor".' },
            condition:      { type: 'string', description: 'The IF clause / the rating variable, e.g. "All-peril deductible selection".' },
            outcome:        { type: 'string', description: 'What the document states about rating, e.g. "Premium varies by territory and construction".' },
            coverageNames:  { type: 'array', items: { type: 'string' }, description: 'Coverage names this hint relates to, if any.' },
            formNumbers:    { type: 'array', items: { type: 'string' }, description: 'Form numbers referenced — only numbers present in the document.' },
            minimumPremium: { type: 'number', description: 'A minimum/deposit premium in dollars, if and only if the document states one.' },
            confidence:     CONFIDENCE,
            citation:       CITATION,
          },
          required: ['condition', 'outcome', 'confidence', 'citation'],
        },
      },
      note: { type: 'string', description: 'If the document contains no rating information, say so explicitly here.' },
    },
    required: ['hints'],
  },
}

// All four tools are sent on EVERY section call (only tool_choice changes). Keeping the
// tools array identical means the cached prefix (system + document + tools) is reused
// across sections, so the document is read once and sections 2–4 hit the cache — far
// cheaper and faster than re-reading it four times.
const ALL_TOOLS: Anthropic.Tool[] = [PROPOSE_COVERAGES, PROPOSE_FORMS, PROPOSE_RULES, PROPOSE_RATING]

const SYSTEM =
  'You are a P&C insurance product analyst extracting a product\'s structure from an uploaded ' +
  'base coverage form. Ground EVERY proposal in the document\'s actual text — never invent a ' +
  'coverage, form number, rule or rating fact. Prefer the exact names and ISO form numbers the ' +
  'document uses. Give each item a 0..1 confidence (lower when the document is ambiguous) and a ' +
  'citation to where you found it. If the document does not define anything for the requested ' +
  'section, return an empty array and say so in `note` rather than guessing. You are called once ' +
  'per section with a single forced tool; call that tool exactly once.'

// One forced-tool round-trip per section, on the given model. Forcing the tool (via
// tool_choice) guarantees a structured result — including an explicit empty section — so
// "found nothing" is honest. The tools array + system + cached document form an identical
// prefix across all sections FOR A GIVEN MODEL (the cache is model-scoped), so the fast
// pass reads the document once and its later sections hit the cache; a strong escalation
// re-reads it under sonnet's own cache. A per-call timeout keeps a stalled request from
// hanging to the function ceiling.
async function runSection(
  client:      Anthropic,
  model:       string,
  docBlock:    Anthropic.ContentBlockParam,
  instruction: string,
  toolName:    string,
  maxTokens:   number,
  usageAccum?: UsageAccum,
): Promise<Record<string, unknown>> {
  const msg = await client.messages.create({
    model,
    max_tokens:  maxTokens,
    system:      SYSTEM,
    tools:       ALL_TOOLS,
    tool_choice: { type: 'tool', name: toolName },
    messages:    [{ role: 'user', content: [docBlock, { type: 'text', text: instruction }] }],
  }, { timeout: 90_000 })
  if (usageAccum) addUsage(usageAccum, msg.usage)
  const tu = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  return (tu?.input as Record<string, unknown> | undefined) ?? {}
}

// The cheap-first escalation CHECK for a section, reusing the shared extraction sanitizers
// as the verifier. `rawCount` is what the fast model proposed; `keptCount` is what survived
// the sanitizer (uncited items + form numbers absent from the source are dropped).
// Exported so the gate can assert the escalation logic deterministically.
export function sectionNeedsEscalation(key: string, rawCount: number, keptCount: number): boolean {
  // Fabrication signal: the fast pass proposed items but the sanitizer dropped them ALL —
  // an ungrounded/hallucinated-citation pattern. Escalate for a cleaner strong pass.
  if (rawCount > 0 && keptCount === 0) return true
  // Under-read signal: a real base COVERAGE form always defines coverages and is itself a
  // form, so an empty coverages/forms section means the fast pass missed the obvious.
  if ((key === 'coverages' || key === 'forms') && keptCount === 0) return true
  return false
}

// Count what the model proposed for a section BEFORE the sanitizer runs (the tool field
// name differs for rating). Used only to detect the "proposed items, all dropped" pattern.
export function proposedCount(key: string, input: Record<string, unknown>): number {
  const field = key === 'rating' ? 'hints' : key
  const arr = input[field]
  return Array.isArray(arr) ? arr.length : 0
}

// ─── The four-section extraction, as a reusable unit ─────────────────────────────
// One implementation drives BOTH the standalone base-form extractor (extractCoverages) AND the
// filing importer's policyForm stage (functions/src/filingImport.ts) — a policy form IS a base
// coverage form, so it runs the SAME four forced tools + sanitizers + cheap-first cascade rather
// than a parallel implementation. Callbacks let the caller stream tool start/end + per-section
// json as each section completes.
interface SectionDef {
  key: string; label: string; tool: Anthropic.Tool; instruction: string; maxTokens: number
  clean: (input: Record<string, unknown>, text: string | null) => ExtractionSection<unknown>
}
function sectionDefs(product: string): SectionDef[] {
  return [
    { key: 'coverages', label: 'coverage', tool: PROPOSE_COVERAGES, maxTokens: 3000,
      instruction: `Product: ${product}. Identify every coverage this base form defines, then call propose_coverages.`,
      clean: cleanCoverages },
    { key: 'forms', label: 'form', tool: PROPOSE_FORMS, maxTokens: 2000,
      instruction: `Product: ${product}. List the forms this document is or references by number, then call propose_forms.`,
      clean: cleanForms },
    { key: 'rules', label: 'rule', tool: PROPOSE_RULES, maxTokens: 2000,
      instruction: `Product: ${product}. Identify the PRODUCT and FORMS rules the document supports, then call propose_rules.`,
      clean: cleanRules },
    { key: 'rating', label: 'rating hint', tool: PROPOSE_RATING, maxTokens: 1500,
      instruction: `Product: ${product}. Identify any rating information the document states, then call propose_rating.`,
      clean: cleanRating },
  ]
}

export interface FourSectionOpts {
  client:       Anthropic
  docBlock:     Anthropic.ContentBlockParam
  verifyText:   string | null
  productName:  string
  degraded:     boolean
  cheapUsage:   UsageAccum
  strongUsage:  UsageAccum
  onTool?:      (key: string, phase: 'start' | 'end', summary?: string) => void
  onSection?:   (key: string, section: ExtractionSection<unknown>) => void
}

/** Run all four forced-tool sections with the cheap-first + per-section escalation cascade and
 *  assemble an ExtractionResult. Escalation is suppressed when `degraded` (a soft budget cap).
 *  Returns the result plus whether any section escalated (for cascade telemetry). */
export async function runFourSectionExtraction(opts: FourSectionOpts): Promise<{ result: ExtractionResult; escalated: boolean }> {
  const { client, docBlock, verifyText, productName, degraded, cheapUsage, strongUsage } = opts
  const sections = sectionDefs(productName)
  const out: Record<string, ExtractionSection<unknown>> = {}
  let escalated = false
  for (const s of sections) {
    opts.onTool?.(s.key, 'start')
    const cheapInput = await runSection(client, MODEL_FAST, docBlock, s.instruction, s.tool.name, s.maxTokens, cheapUsage)
    let section = s.clean(cheapInput, verifyText)
    if (!degraded && sectionNeedsEscalation(s.key, proposedCount(s.key, cheapInput), section.items.length)) {
      escalated = true
      const strongInput = await runSection(client, MODEL, docBlock, s.instruction, s.tool.name, s.maxTokens, strongUsage)
      section = s.clean(strongInput, verifyText)
    }
    const n = section.items.length
    opts.onTool?.(s.key, 'end', `${n} ${s.label}${n === 1 ? '' : 's'}`)
    opts.onSection?.(s.key, section)
    out[s.key] = section
  }
  return {
    result: {
      coverages: out.coverages as ExtractionResult['coverages'],
      forms:     out.forms as ExtractionResult['forms'],
      rules:     out.rules as ExtractionResult['rules'],
      rating:    out.rating as ExtractionResult['rating'],
    },
    escalated,
  }
}

export const extractCoverages = onRequest(
  { secrets: [ANTHROPIC_API_KEY], cors: true, timeoutSeconds: 240, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

    // Author-only: extraction proposes writes, so guard like a mutation (mirrors the
    // Firestore rules the eventual mutate() will hit — role enforced on BOTH sides).
    let caller
    try {
      caller = await authenticate(req)
      if (caller.role !== 'EDITOR' && caller.role !== 'ADMIN') {
        res.status(403).json({ error: 'Editor access required.' }); return
      }
    } catch (e) {
      res.status(401).json({ error: e instanceof AuthError ? e.message : 'Unauthorized' }); return
    }

    openSse(res)
    // Cheap-first cascade accumulators: the fast (haiku) pass fills cheapUsage; any section
    // that fails its sanitizer check escalates to the reasoning model into strongUsage.
    const cheapUsage  = emptyUsage()
    const strongUsage = emptyUsage()
    let escalated = false
    let degraded  = false
    let blocked: 'deny' | 'breaker' | null = null
    const t0 = Date.now()
    let ok = true
    const body       = (req.body ?? {}) as ExtractBody
    const sessionKey = body.sessionId?.trim() || caller.uid
    try {

      // Build the document block once and mark it ephemeral so it is cached and reused
      // across all four section calls (which now share an identical tools prefix). For
      // both paths we ALSO derive `verifyText` so the shared sanitizers can verify every
      // proposed form number against the source. Text uploads carry their text directly;
      // for a PDF we recover text SERVER-SIDE (C3) so the primary upload path is verified
      // too — extraction fails safe to null (skip verification, rely on citation +
      // never-invent) rather than false-dropping a real number on a PDF we can't read.
      let docBlock: Anthropic.ContentBlockParam
      let verifyText: string | null
      if (body.formBase64 && body.mediaType === 'application/pdf') {
        docBlock = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: body.formBase64 }, cache_control: CACHE_1H }
        verifyText = extractPdfText(body.formBase64)
      } else if (body.formText?.trim()) {
        verifyText = body.formText.slice(0, 120_000)
        docBlock = { type: 'text', text: `BASE COVERAGE FORM:\n\n${verifyText}`, cache_control: CACHE_1H }
      } else {
        send(res, { t: 'error', message: 'No form content provided.' }); return
      }

      // Part C — cost cap + breaker gate. A hard/breaker block streams a notice + done here;
      // a soft cap keeps the cheap-first pass but suppresses the Sonnet escalation (degraded).
      const gate = await sseCostGate(res, 'extractCoverages', sessionKey)
      if (!gate.proceed) { blocked = gate.blocked; return }
      degraded = gate.degraded

      const product = body.productName ?? 'this product'
      const client = anthropic()

      // The four forced-tool sections run through the shared cascade (also used by the filing
      // importer's policyForm stage). Callbacks stream tool start/end + each section's json.
      const { escalated: didEscalate } = await runFourSectionExtraction({
        client, docBlock, verifyText, productName: product, degraded, cheapUsage, strongUsage,
        onTool:    (name, phase, summary) => send(res, { t: 'tool', name, phase, ...(summary ? { summary } : {}) }),
        onSection: (key, section) => send(res, { t: 'json', key, value: section }),
      })
      escalated = didEscalate

      send(res, { t: 'done' })
    } catch (err) {
      ok = false
      console.error('[extractCoverages] internal error:', err)
      send(res, { t: 'error', message: 'Extraction failed.' })
    } finally {
      res.end()
      if (blocked) {
        // Gated before any model call — record a no-provider-call row so the breaker isn't
        // falsely healed and the deny/degrade is visible in the cost tab.
        void recordUsage({
          feature: 'extractCoverages', model: MODEL_FAST, usage: emptyUsage(), latencyMs: Date.now() - t0,
          ok: true, sessionKey, denied: blocked === 'deny', degraded: blocked === 'breaker', providerCalled: false,
        })
      } else {
        // Latency is invocation-level (cheap + escalated sections interleave); attribute it to
        // the cheap record and leave the strong record's latency at 0 rather than double-count.
        void recordCascade({
          feature: 'extractCoverages', cheapUsage, cheapLatencyMs: Date.now() - t0, ok,
          strongUsage: escalated ? strongUsage : undefined, sessionKey,
        })
      }
    }
  },
)
