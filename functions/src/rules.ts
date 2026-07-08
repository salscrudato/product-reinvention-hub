// rules.ts — the grounded "rule composer". A product manager describes a rule in
// plain English (or asks to refine an existing one); the model reads the product's
// REAL coverages, forms, LD tables and existing rules via the grounding tools, then
// emits a structured draft as an IF → THEN condition/outcome with grounded citations.
//
// Two guarantees make this safe rather than free invention:
//   • The model is told to reference only entities a tool actually returned.
//   • Every coverageRefId / formNumber / ldTableRef in the emitted draft is then
//     VERIFIED server-side against Firestore before we hand it back — anything that
//     doesn't resolve is dropped and reported as a warning. So the draft that reaches
//     the UI (and, on Save, mutate()) can never carry an invented reference.
//
// Writes NOTHING itself — the browser persists the (edited) draft through the adapter's
// atomic mutate(). AWS-SWAP: onRequest → Lambda URL; auth + secret live in runtime.ts.
import { onRequest } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, authenticate, AuthError, MODEL, openSse, send, ANTHROPIC_API_KEY } from './runtime'
import { runChatAgent } from './ai'
import { TOOLS, runTool } from './tools'
import type { ToolOutput } from './tools'
import { emptyUsage, recordUsage } from './telemetry'

// ─── Structured draft (the composer card contract) ──────────────────────────────
// The model calls this exactly once, as its final action. Its input is the payload
// the composer renders as an editable rule draft, so the shape mirrors a Rule.
const EMIT_RULE_DRAFT_TOOL: Anthropic.Tool = {
  name: 'emit_rule_draft',
  description:
    'Record the drafted or refined product rule. Call this exactly once, as your FINAL ' +
    'action, after you have gathered every fact you need from the other tools. Every ' +
    'coverageRefId, formNumber and ldTableRef you include MUST come from a tool result — ' +
    'never invent one. If you cannot ground a reference, omit it and explain in notes.',
  input_schema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['PRODUCT', 'RATING', 'FORMS'],
        description: 'PRODUCT (eligibility, coverage limits/constraints, packaging), RATING (deductibles, factors, premium floor), or FORMS (form attachment).',
      },
      subCategory: {
        type: 'string',
        description: 'A sub-category consistent with the line\'s existing taxonomy, e.g. "Eligibility", "Coverage Limits", "Coverage Constraints", "Deductibles", "Premium Floor". Prefer an existing sub-category over inventing a new one.',
      },
      condition: { type: 'string', description: 'The IF clause — the trigger, short and declarative in the house voice.' },
      outcome:   { type: 'string', description: 'The THEN clause — what the rule requires, blocks, attaches or sets.' },
      coverageRefIds: {
        type: 'array', items: { type: 'string' },
        description: 'Coverage refIds the rule governs, e.g. HO.COV.005. Only ones a tool returned.',
      },
      formNumbers: {
        type: 'array', items: { type: 'string' },
        description: 'Form numbers the rule attaches or references, e.g. HO 04 90. Only ones a tool returned.',
      },
      ldTableRef: { type: 'string', description: 'The LD option table the rule reads, e.g. HO.LD.002, if any.' },
      rationale: {
        type: 'array', items: { type: 'string' },
        description: '1–3 short sentences justifying the rule, each citing the coverage / form / table it relied on in [brackets].',
      },
      citations: {
        type: 'array', items: { type: 'string' },
        description: 'Every refId / form number relied on, e.g. ["HO.COV.005","HO.LD.002"].',
      },
      notes: { type: 'string', description: 'Optional caveats or gaps — e.g. a reference you could not ground.' },
    },
    required: ['category', 'subCategory', 'condition', 'outcome'],
  },
}

const RULES_TOOLS: Anthropic.Tool[] = [...TOOLS, EMIT_RULE_DRAFT_TOOL]

// Composer-specific context, layered on the house grounding rules (SYSTEM_PROMPT).
const RULES_SYSTEM = `You are the Product Reinvention Hub rule-drafting assistant for P&C product managers. You draft or refine exactly ONE product rule as a precise IF → THEN statement (a condition and an outcome), grounded entirely in the product's real data.

WORKFLOW:
1. Use the grounding tools SILENTLY first to find the coverages, forms, LD tables and existing rules the request touches. Never narrate your process or mention the tools; the product manager sees only the finished draft.
2. Choose the category — PRODUCT (eligibility, coverage limits/constraints, packaging), RATING (deductibles, factors, premium floor) or FORMS (form attachment) — and a subCategory consistent with the line's existing rules (e.g. Eligibility, Coverage Limits, Coverage Constraints, Deductibles, Premium Floor, Base Coverage, Limit Ranges and Defaults, Mandatory Inclusion/Exclusion of Coverage). Prefer an existing subCategory to a new one; call get_rules to see what the line already uses.
3. Write a tight condition and outcome in the house voice — short, declarative, like the seeded rules (e.g. condition "Coverage F $5,000 limit selected" → outcome "Requires Coverage E ≥ $300,000").
4. Reference ONLY real entities: coverage refIds, form numbers and LD table refs a tool actually returned. If a reference cannot be grounded, DO NOT include it — omit it and note the gap in notes. Never invent a refId, form number, coverage or table.
5. Call emit_rule_draft exactly once as your final action. Do not write prose after it.

When refining an existing rule, preserve its intent and refId and change only what the request asks; keep every citation grounded.`

// ─── Server-side citation verification (the "never invents" guarantee) ──────────

interface RuleDraft {
  category:       'PRODUCT' | 'RATING' | 'FORMS'
  subCategory:    string
  condition:      string
  outcome:        string
  coverageRefIds: string[]
  formNumbers:    string[]
  ldTableRef?:    string
  rationale:      string[]
  citations:      string[]
  notes?:         string
}

/** Keep only the references that actually exist in Firestore. Returns the cleaned
 *  draft plus a warning per reference that was dropped, so the model's output can
 *  never carry an invented coverage, form or table into the UI (or, on Save, mutate). */
async function verifyDraft(input: Record<string, unknown>): Promise<{ draft: RuleDraft; warnings: string[] }> {
  const db = getFirestore()
  const warnings: string[] = []
  const str = (v: unknown): string => String(v ?? '').trim()
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : [])

  // Coverage refIds — must resolve to a real coverage (any product).
  const keptCov: string[] = []
  for (const ref of [...new Set(arr(input.coverageRefIds))]) {
    const snap = await db.collectionGroup('coverages').where('refId', '==', ref).limit(1).get()
    if (!snap.empty) keptCov.push(ref)
    else warnings.push(`Dropped unverified coverage reference ${ref}`)
  }

  // Form numbers — must resolve to a real form.
  const keptForms: string[] = []
  for (const num of [...new Set(arr(input.formNumbers))]) {
    const snap = await db.collection('forms').where('number', '==', num).limit(1).get()
    if (!snap.empty) keptForms.push(num)
    else warnings.push(`Dropped unverified form ${num}`)
  }

  // LD table ref — must resolve to a real table document.
  let ldTableRef: string | undefined
  const rawLd = str(input.ldTableRef)
  if (rawLd) {
    const doc = await db.doc(`ldTables/${rawLd}`).get()
    if (doc.exists) ldTableRef = rawLd
    else warnings.push(`Dropped unverified table ${rawLd}`)
  }

  // Citations are display-only; narrow them to the references we verified so the card
  // never shows a chip we couldn't stand behind.
  const verified = new Set<string>([...keptCov, ...keptForms, ...(ldTableRef ? [ldTableRef] : [])])
  const citations = [...new Set(arr(input.citations))].filter(c => verified.has(c))

  const category = str(input.category).toUpperCase()
  const draft: RuleDraft = {
    category: (category === 'RATING' || category === 'FORMS' ? category : 'PRODUCT') as RuleDraft['category'],
    subCategory:    str(input.subCategory) || 'Authored',
    condition:      str(input.condition),
    outcome:        str(input.outcome),
    coverageRefIds: keptCov,
    formNumbers:    keptForms,
    ldTableRef,
    rationale:      arr(input.rationale),
    citations,
    notes:          str(input.notes) || undefined,
  }
  return { draft, warnings }
}

// ─── draftRule — the grounded composer (SSE) ────────────────────────────────────

interface DraftBody {
  instruction?: string
  productId?:   string
  lobPrefix?:   string   // e.g. 'HO' | 'GL' — steer the model to the right line's refIds
  existingRule?: {
    refId?: string | null; category?: string; subCategory?: string
    condition?: string; outcome?: string
    coverageRefIds?: string[]; formNumbers?: string[]; ldTableRef?: string
  }
}

export const draftRule = onRequest(
  { secrets: [ANTHROPIC_API_KEY], cors: true, timeoutSeconds: 300, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

    // Author-only: drafting is part of the authoring flow. Role is enforced HERE
    // (in the Function) as well as in Firestore rules on the eventual mutate() — both sides.
    let caller
    try { caller = await authenticate(req) }
    catch (e) { res.status(401).json({ error: e instanceof AuthError ? e.message : 'Unauthorized' }); return }
    if (caller.role !== 'EDITOR' && caller.role !== 'ADMIN') {
      res.status(403).json({ error: 'Editor access required to draft rules.' }); return
    }

    openSse(res)
    const usageAccum = emptyUsage()
    const t0 = Date.now()
    let ok = true
    try {
      const body        = (req.body ?? {}) as DraftBody
      const instruction = body.instruction?.trim()
      if (!instruction) { send(res, { t: 'error', message: 'Describe the rule you want to draft.' }); return }

      const parts: string[] = []
      if (body.lobPrefix) {
        parts.push(`Line of business: ${body.lobPrefix}. Draft for this line and use its refId conventions (${body.lobPrefix}.COV.*, ${body.lobPrefix}.LD.* and its form numbers).`)
      }
      if (body.existingRule) {
        parts.push(`You are REFINING this existing rule — keep its refId (${body.existingRule.refId ?? 'unassigned'}) and its intent, changing only what the request asks:\n${JSON.stringify(body.existingRule)}`)
      }
      parts.push(`Product manager's request: ${instruction}`)

      const focus = body.productId
        ? `The product in focus is ${body.productId}. Prefer it when a productId is needed.`
        : 'There may be more than one product; resolve the right one via search_entities before reading rules.'

      const messages: Anthropic.MessageParam[] = [{ role: 'user', content: parts.join('\n\n') }]

      // Custom executor: verify + surface the structured draft as a `json` event;
      // delegate every grounding tool to the shared runTool.
      const runDraftTool = async (name: string, input: Record<string, unknown>): Promise<ToolOutput> => {
        if (name === 'emit_rule_draft') {
          const { draft, warnings } = await verifyDraft(input)
          send(res, { t: 'json', key: 'rule_draft', value: { ...draft, warnings } })
          return { content: JSON.stringify({ recorded: true, warnings }), summary: warnings.length ? `draft ready (${warnings.length} dropped)` : 'draft ready' }
        }
        return runTool(name, input)
      }

      await runChatAgent(anthropic(), messages, res, {
        system:      RULES_SYSTEM,
        context:     focus,
        tools:       RULES_TOOLS,
        runTool:     runDraftTool,
        maxTokens:   1800,
        maxTurns:    7,
        usageAccum,
      })
      send(res, { t: 'done' })
    } catch (err) {
      ok = false
      console.error('[draftRule] internal error:', err)
      send(res, { t: 'error', message: 'Draft failed.' })
    } finally {
      res.end()
      void recordUsage({ feature: 'draftRule', model: MODEL, usage: usageAccum, latencyMs: Date.now() - t0, ok })
    }
  },
)
