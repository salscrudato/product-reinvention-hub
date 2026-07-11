// filingImport.ts — the FILING importer's server pipeline: turn a real carrier rate filing (a
// set of PDFs) into ONE reviewable, governed product bundle. This is the platform's SECOND
// ingestion mechanism; the ISO-workbook importer (app/src/lib/import) handles structured
// spreadsheets, and this handles the documents carriers actually file.
//
// Three staged, grounded, cost-guarded stages over SSE (EDITOR/ADMIN only):
//
//   CLASSIFY — pdfText each upload, then a forced `classify_filing_document` tool (cheap model)
//              decides its role from STRUCTURAL cues (title lines, rate-order phrasing, numbered
//              -rule density, a form-number/edition footer), citing the cue.
//   EXTRACT  — role-specific forced tools following extract.ts's cheap-first→escalate cascade:
//              • rateOrder  → the ordered variable list (add/multiply, stage, per-form
//                             applicability) + the referenced cap/floor rules;
//              • manual     → per numbered rule, its concept + either a table SCHEMA handed to
//                             the DETERMINISTIC parser (never model-authored rows) or scalar
//                             facts, with eligibility prose distilled to rule drafts;
//              • policyForm → runs the EXISTING extractCoverages four-section machinery
//                             (runFourSectionExtraction), not a parallel implementation.
//   RECONCILE— the pure, deterministic reconcileFiling() joins the three into one ImportPlan +
//              review bundle: product shell, coverage tree, RT/LD tables, rules, and a
//              RatingProgram mapping onto engine ops (SET/MUL/ADD/MIN_FLOOR + creditFloor).
//              Anything that can't be grounded is emitted UNRESOLVED — never guessed.
//
// The model can never inject a factor: table rows come from deterministic parsing of the
// verbatim region; the model only discovers the schema. Nothing persists here — the reviewed
// bundle is written by the app through adapter.db.mutate() (lineage IMPORT).
import { onRequest } from 'firebase-functions/v2/https'
import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, authenticate, AuthError, MODEL, MODEL_FAST, openSse, send, ANTHROPIC_API_KEY, CACHE_1H } from './runtime'
import type { StreamEvent } from './runtime'
import { extractPdfText } from './pdfText'
import { runFourSectionExtraction } from './extract'
import { sseCostGate } from './ai'
import { emptyUsage, addUsage, recordCascade, recordUsage } from './telemetry'
import type { UsageAccum } from './telemetry'
import {
  sanitizeClassification, sanitizeRateOrder, sanitizeManual, reconcileFiling,
  type FilingDocClassification, type FilingExtraction, type FilingImportPlan,
  type ExtractionResult,
} from '@pf/shared'

// ─── Forced tools ───────────────────────────────────────────────────────────────────

const CONFIDENCE = { type: 'number', description: '0..1 confidence in this classification/proposal.' } as const
const CITATION   = { type: 'string', description: 'Where in the document this was found (heading / rule number / page). REQUIRED — items without a citation are discarded.' } as const

const CLASSIFY_TOOL: Anthropic.Tool = {
  name: 'classify_filing_document',
  description:
    'Classify ONE filing document by its role, from STRUCTURAL cues — not the filename. ' +
    'rateOrder: a "rate order of calculations" with ordered Premium/Factor rows and per-form ' +
    'applicability columns. manual: a rate manual with dense NUMBERED rules and factor tables. ' +
    'policyForm: the policy contract, with a form-number/edition footer and coverage sections. ' +
    'other: none of these. Cite the specific cue you used.',
  input_schema: {
    type: 'object',
    properties: {
      role: { type: 'string', enum: ['rateOrder', 'manual', 'policyForm', 'other'] },
      cue: CITATION, confidence: CONFIDENCE,
    },
    required: ['role', 'cue', 'confidence'],
  },
}

const RATE_ORDER_TOOL: Anthropic.Tool = {
  name: 'propose_rate_order',
  description:
    'Return the rate order of calculations as an ORDERED list of rating variables, exactly as ' +
    'the document sequences them. Each variable: op ADD for a Premium (additive) row or MUL for ' +
    'a Factor (multiplicative) row; the stage it belongs to; the product forms it applies to ' +
    '(from the per-form applicability columns). Also return the referenced maximum-credit and ' +
    'minimum-premium rules if the document annotates them. Never invent a variable.',
  input_schema: {
    type: 'object',
    properties: {
      variables: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The rating variable name exactly as printed.' },
            op: { type: 'string', enum: ['ADD', 'MUL'], description: 'ADD = Premium (additive); MUL = Factor (multiplicative).' },
            stage: { type: 'string', enum: ['BASE_LOSS_COST', 'BASE_PREMIUM', 'ADJUSTED_BASE', 'INCREASED_LIMIT', 'ADDITIONAL_COVERAGE'] },
            forms: { type: 'array', items: { type: 'string' }, description: 'Forms this row applies to (e.g. ["HO3"]).' },
            confidence: CONFIDENCE, citation: CITATION,
          },
          required: ['name', 'op', 'stage', 'confidence', 'citation'],
        },
      },
      maxCreditRuleRef: { type: 'string', description: 'The referenced maximum-credit rule, e.g. "Rule 92".' },
      minPremiumRuleRef: { type: 'string', description: 'The referenced minimum-premium rule, e.g. "Rule 205".' },
      note: { type: 'string' },
    },
    required: ['variables'],
  },
}

const MANUAL_TOOL: Anthropic.Tool = {
  name: 'propose_manual_rules',
  description:
    'Return the manual\'s NUMBERED rules. For each rule give its number, title, a kind, and the ' +
    'concept it governs. CRITICAL: never transcribe a table\'s rows. For a factor table, return ' +
    'its SCHEMA — layout (pairs = 1-key→value; triples = 2-keys→value; matrix = row-label × ' +
    'column-headers → value), the key column names, the value column name, (matrix only) the ' +
    'column-header values, and the VERBATIM text region (rowRegion) copied from the page — ' +
    'deterministic code parses the rows. For scalar facts (a single factor, per-form minimum ' +
    'premiums, a maximum-credit percentage) use scalars. Distil eligibility prose into a ' +
    'condition→outcome ruleDraft. Never invent a rule, a factor or a row.',
  input_schema: {
    type: 'object',
    properties: {
      rules: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            ruleNumber: { type: 'string' },
            title: { type: 'string' },
            kind: { type: 'string', enum: ['BASE_LOSS_COST', 'FACTOR_TABLE', 'SCALAR', 'DEDUCTIBLE', 'CREDIT_CAP', 'MIN_PREMIUM', 'PREMIUM_CAP', 'SCHEDULED_PROPERTY', 'PROTECTIVE_DEVICE', 'ENDORSEMENT_SCHEDULE', 'ELIGIBILITY', 'OTHER'] },
            concept: { type: 'string', description: 'A short concept key (e.g. "tier", "allPerilDed", "loyalty") joining this rule to the rate order.' },
            table: {
              type: 'object',
              properties: {
                layout: { type: 'string', enum: ['pairs', 'triples', 'matrix'] },
                keyColumns: { type: 'array', items: { type: 'string' } },
                valueColumn: { type: 'string' },
                columnKeys: { type: 'array', items: { type: 'string' }, description: 'matrix only: the column-header values.' },
                rowRegion: { type: 'string', description: 'The VERBATIM text region of the table, copied from the page.' },
              },
              required: ['layout', 'keyColumns', 'valueColumn', 'rowRegion'],
            },
            scalars: {
              type: 'array',
              items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'number' }, form: { type: 'string' } }, required: ['value'] },
            },
            ruleDraft: { type: 'object', properties: { condition: { type: 'string' }, outcome: { type: 'string' } }, required: ['condition', 'outcome'] },
            confidence: CONFIDENCE, citation: CITATION,
          },
          required: ['ruleNumber', 'title', 'confidence', 'citation'],
        },
      },
      note: { type: 'string' },
    },
    required: ['rules'],
  },
}

const CLASSIFY_SYSTEM = 'You are a P&C filing analyst. Classify each document by role from its structure, and cite the cue. Call the tool exactly once.'
const EXTRACT_SYSTEM =
  'You are a P&C actuarial analyst reading a rate filing. Ground EVERY item in the document\'s ' +
  'actual text — never invent a variable, rule, factor, table row or number. Cite each item. For ' +
  'tables, return a SCHEMA + the verbatim region; deterministic code parses the rows. Call the ' +
  'forced tool exactly once.'

// ─── Document blocks + one forced-tool round-trip ─────────────────────────────────────

export interface FilingDoc { name: string; base64?: string; text?: string; mediaType?: string }

function docBlockOf(doc: FilingDoc): { block: Anthropic.ContentBlockParam; verifyText: string | null } {
  if (doc.base64 && (doc.mediaType ?? 'application/pdf') === 'application/pdf') {
    return {
      block: { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: doc.base64 }, cache_control: CACHE_1H },
      verifyText: extractPdfText(doc.base64),
    }
  }
  const text = (doc.text ?? '').slice(0, 200_000)
  return { block: { type: 'text', text: `FILING DOCUMENT (${doc.name}):\n\n${text}`, cache_control: CACHE_1H }, verifyText: text || null }
}

async function forcedTool(
  client: Anthropic, model: string, system: string, tools: Anthropic.Tool[], toolName: string,
  block: Anthropic.ContentBlockParam, instruction: string, maxTokens: number, usage?: UsageAccum,
): Promise<Record<string, unknown>> {
  const msg = await client.messages.create({
    model, max_tokens: maxTokens, system, tools, tool_choice: { type: 'tool', name: toolName },
    messages: [{ role: 'user', content: [block, { type: 'text', text: instruction }] }],
  }, { timeout: 120_000 })
  if (usage) addUsage(usage, msg.usage)
  const tu = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  return (tu?.input as Record<string, unknown> | undefined) ?? {}
}

// ─── The pipeline (client-injected so the gate can drive it with AI_FAKE) ─────────────

export interface FilingPipelineOpts {
  client:           Anthropic
  documents:        FilingDoc[]
  productNameHint?: string
  filingStateHint?: string
  degraded:         boolean
  cheapUsage:       UsageAccum
  strongUsage:      UsageAccum
  emit?:            (ev: StreamEvent) => void
}

/** Run CLASSIFY → EXTRACT → RECONCILE and return the reviewable bundle. Pure of HTTP/SSE
 *  (the `emit` callback is the only side channel), so a test drives it with a fake client. */
export async function runFilingPipeline(opts: FilingPipelineOpts): Promise<{ bundle: FilingImportPlan; extraction: FilingExtraction; escalated: boolean }> {
  const { client, documents, degraded, cheapUsage, strongUsage } = opts
  const emit = opts.emit ?? (() => {})
  let escalated = false

  // ── CLASSIFY ──
  emit({ t: 'tool', name: 'classify', phase: 'start' })
  const blocks = documents.map(d => ({ doc: d, ...docBlockOf(d) }))
  const classifications: FilingDocClassification[] = []
  for (const { doc, block } of blocks) {
    const input = await forcedTool(client, MODEL_FAST, CLASSIFY_SYSTEM, [CLASSIFY_TOOL], CLASSIFY_TOOL.name, block, `Classify this document (filename: "${doc.name}").`, 500, cheapUsage)
    classifications.push(sanitizeClassification(doc.name, input))
  }
  emit({ t: 'tool', name: 'classify', phase: 'end', summary: classifications.map(c => `${c.name.split(/[\\/]/).pop()} → ${c.role}`).join(', ') })
  emit({ t: 'json', key: 'classifications', value: classifications })

  const roleOf = (r: string) => blocks.find((_, i) => classifications[i]!.role === r)
  const rateOrderDoc  = roleOf('rateOrder')
  const manualDoc     = roleOf('manual')
  const policyFormDoc = roleOf('policyForm')

  // ── EXTRACT · rate order ──
  let rateOrder: FilingExtraction['rateOrder'] = { variables: [] }
  if (rateOrderDoc) {
    emit({ t: 'tool', name: 'extract:rateOrder', phase: 'start' })
    let raw = await forcedTool(client, MODEL_FAST, EXTRACT_SYSTEM, [RATE_ORDER_TOOL], RATE_ORDER_TOOL.name, rateOrderDoc.block, 'Extract the rate order of calculations, in order.', 4000, cheapUsage)
    rateOrder = sanitizeRateOrder(raw)
    if (!degraded && rateOrder.variables.length === 0) {          // fabrication/under-read → escalate
      escalated = true
      raw = await forcedTool(client, MODEL, EXTRACT_SYSTEM, [RATE_ORDER_TOOL], RATE_ORDER_TOOL.name, rateOrderDoc.block, 'Extract the rate order of calculations, in order.', 4000, strongUsage)
      rateOrder = sanitizeRateOrder(raw)
    }
    emit({ t: 'tool', name: 'extract:rateOrder', phase: 'end', summary: `${rateOrder.variables.length} variables` })
  }

  // ── EXTRACT · manual ──
  let manual: FilingExtraction['manual'] = { rules: [] }
  if (manualDoc) {
    emit({ t: 'tool', name: 'extract:manual', phase: 'start' })
    let raw = await forcedTool(client, MODEL_FAST, EXTRACT_SYSTEM, [MANUAL_TOOL], MANUAL_TOOL.name, manualDoc.block, 'Extract the manual\'s numbered rules — schemas + verbatim regions for tables, scalars for single facts.', 8000, cheapUsage)
    manual = sanitizeManual(raw)
    if (!degraded && manual.rules.length === 0) {
      escalated = true
      raw = await forcedTool(client, MODEL, EXTRACT_SYSTEM, [MANUAL_TOOL], MANUAL_TOOL.name, manualDoc.block, 'Extract the manual\'s numbered rules — schemas + verbatim regions for tables, scalars for single facts.', 8000, strongUsage)
      manual = sanitizeManual(raw)
    }
    emit({ t: 'tool', name: 'extract:manual', phase: 'end', summary: `${manual.rules.length} rules` })
  }

  // ── EXTRACT · policy form (the EXISTING four-section extractCoverages machinery) ──
  let policyForm: ExtractionResult = { coverages: { items: [] }, forms: { items: [] }, rules: { items: [] }, rating: { items: [] } }
  if (policyFormDoc) {
    const { result, escalated: pfEsc } = await runFourSectionExtraction({
      client, docBlock: policyFormDoc.block, verifyText: policyFormDoc.verifyText,
      productName: opts.productNameHint ?? 'this filing', degraded, cheapUsage, strongUsage,
      onTool: (name, phase, summary) => emit({ t: 'tool', name: `policyForm:${name}`, phase, ...(summary ? { summary } : {}) }),
    })
    policyForm = result
    escalated = escalated || pfEsc
  }

  // ── RECONCILE (pure, deterministic) ──
  emit({ t: 'tool', name: 'reconcile', phase: 'start' })
  const baseForm = policyForm.forms.items.find(f => f.category === 'BASE_COVERAGE') ?? policyForm.forms.items[0]
  const extraction: FilingExtraction = {
    classifications, rateOrder, manual, policyForm,
    filingState: opts.filingStateHint || 'NJ',
    baseFormNumber: baseForm?.number || 'BASE',
    baseFormEdition: baseForm?.edition || '',
    productName: opts.productNameHint || (baseForm?.name ? `${baseForm.name}` : 'Imported filing'),
  }
  const bundle = reconcileFiling(extraction)
  emit({ t: 'tool', name: 'reconcile', phase: 'end', summary: `${bundle.counts.accepted} accepted · ${bundle.counts.unresolved} unresolved` })
  emit({ t: 'json', key: 'bundle', value: bundle })

  return { bundle, extraction, escalated }
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────────

interface FilingBody {
  documents?:   FilingDoc[]
  productName?: string
  filingState?: string
  sessionId?:   string
}

export const filingImport = onRequest(
  { secrets: [ANTHROPIC_API_KEY], cors: true, timeoutSeconds: 300, memory: '1GiB' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

    // Author-only: the importer proposes writes, so guard like a mutation (mirrors the Firestore
    // rules the eventual mutate() will hit — role enforced on BOTH sides).
    let caller
    try {
      caller = await authenticate(req)
      if (caller.role !== 'EDITOR' && caller.role !== 'ADMIN') { res.status(403).json({ error: 'Editor access required.' }); return }
    } catch (e) {
      res.status(401).json({ error: e instanceof AuthError ? e.message : 'Unauthorized' }); return
    }

    openSse(res)
    const cheapUsage = emptyUsage()
    const strongUsage = emptyUsage()
    let escalated = false
    let blocked: 'deny' | 'breaker' | null = null
    const t0 = Date.now()
    let ok = true
    const body = (req.body ?? {}) as FilingBody
    const sessionKey = body.sessionId?.trim() || caller.uid
    try {
      const documents = (body.documents ?? []).filter(d => d && (d.base64 || d.text) && d.name)
      if (documents.length === 0) { send(res, { t: 'error', message: 'No filing documents provided.' }); return }
      if (documents.length > 6) { send(res, { t: 'error', message: 'Too many documents (max 6).' }); return }

      const gate = await sseCostGate(res, 'filingImport', sessionKey)
      if (!gate.proceed) { blocked = gate.blocked; return }

      const { escalated: didEscalate } = await runFilingPipeline({
        client: anthropic(), documents, productNameHint: body.productName, filingStateHint: body.filingState,
        degraded: gate.degraded, cheapUsage, strongUsage,
        emit: (ev) => send(res, ev),
      })
      escalated = didEscalate

      send(res, { t: 'done' })
    } catch (err) {
      ok = false
      console.error('[filingImport] internal error:', err)
      send(res, { t: 'error', message: 'Filing import failed.' })
    } finally {
      res.end()
      if (blocked) {
        void recordUsage({ feature: 'filingImport', model: MODEL_FAST, usage: emptyUsage(), latencyMs: Date.now() - t0, ok: true, sessionKey, denied: blocked === 'deny', degraded: blocked === 'breaker', providerCalled: false })
      } else {
        void recordCascade({ feature: 'filingImport', cheapUsage, cheapLatencyMs: Date.now() - t0, ok, strongUsage: escalated ? strongUsage : undefined, sessionKey })
      }
    }
  },
)
