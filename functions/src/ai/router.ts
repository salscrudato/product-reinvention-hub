// ai/router.ts — Foundry model router for the import ensemble.
//
// SECRETS: AZURE_FOUNDRY_ENDPOINT and AZURE_FOUNDRY_KEY are read from process.env
// here (server-side only). They must NEVER appear in client code or logs.
//
// Two SDK families:
//   anthropic → @anthropic-ai/sdk with baseURL = {endpoint}/anthropic
//   openai    → raw fetch with POST {endpoint}/openai/v1/chat/completions
//
// Architecture:
//   extractFieldsWithRole()  — single extraction call on a named role
//   ensembleExtract()        — dual-family (opus + gpt) + haiku adjudication
//   RoutingBudget            — per-job token accounting with configurable ceiling
//
// Confidence calibration: calibratedConfidence comes from inter-model AGREEMENT,
// not from any model's self-reported confidence. This avoids verbalized overconfidence.

import Anthropic from '@anthropic-ai/sdk'
import type { FieldDisagreement } from '@pf/shared'
import { resolveDeployment } from '@pf/shared'
import type { ModelRole } from '@pf/shared'

// ─── Cost guard (per import job) ──────────────────────────────────────────────

export interface RoutingBudget {
  /** Total tokens consumed so far this job (input + output, all models). */
  tokensUsed:   number
  /** Maximum tokens allowed before degrading to cheaper models. */
  tokenCeiling: number
  /** Whether the budget ceiling has been hit and degradation is active. */
  degraded:     boolean
  /** Log of degradation events for the review UI. */
  warnings:     string[]
}

export function createBudget(tokenCeiling = 200_000): RoutingBudget {
  return { tokensUsed: 0, tokenCeiling, degraded: false, warnings: [] }
}

function trackUsage(budget: RoutingBudget, tokens: number, model: string): void {
  budget.tokensUsed += tokens
  if (!budget.degraded && budget.tokensUsed > budget.tokenCeiling) {
    budget.degraded = true
    budget.warnings.push(
      `Budget ceiling ${budget.tokenCeiling.toLocaleString()} tokens exceeded after ${model}. ` +
      `Degrading to cheaper models for remaining calls.`,
    )
  }
}

// ─── Foundry client helpers ───────────────────────────────────────────────────

function getFoundryEndpoint(): string {
  const ep = process.env['AZURE_FOUNDRY_ENDPOINT']
  if (!ep) throw new Error('AZURE_FOUNDRY_ENDPOINT is not set')
  return ep.replace(/\/$/, '')
}

function getFoundryKey(): string {
  const key = process.env['AZURE_FOUNDRY_KEY']
  if (!key) throw new Error('AZURE_FOUNDRY_KEY is not set')
  return key
}

// Anthropic SDK client pointed at Foundry's /anthropic surface.
function makeAnthropicClient(): Anthropic {
  return new Anthropic({
    apiKey:  getFoundryKey(),
    baseURL: `${getFoundryEndpoint()}/anthropic`,
  })
}

// ─── OpenAI raw fetch (no openai npm package — mirrors server/lib/ai.js pattern) ─

interface OpenAIMessage { role: 'system' | 'user' | 'assistant'; content: string }
interface OpenAIChoice  { message: { content: string | null } }
interface OpenAIResponse {
  choices: OpenAIChoice[]
  usage?: { prompt_tokens: number; completion_tokens: number }
}

async function openAiChat(
  deploymentName: string,
  messages:       OpenAIMessage[],
  maxTokens       = 4096,
): Promise<{ content: string; tokens: number }> {
  const endpoint = `${getFoundryEndpoint()}/openai/v1/chat/completions`
  const key      = getFoundryKey()

  const resp = await fetch(endpoint, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({ model: deploymentName, messages, max_tokens: maxTokens }),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`OpenAI Foundry ${deploymentName} ${resp.status}: ${text}`)
  }

  const json = (await resp.json()) as OpenAIResponse
  const content = json.choices[0]?.message?.content ?? ''
  const tokens  = (json.usage?.prompt_tokens ?? 0) + (json.usage?.completion_tokens ?? 0)
  return { content, tokens }
}

// ─── Field extraction payload ─────────────────────────────────────────────────

export interface ExtractionRequest {
  systemPrompt: string
  userPrompt:   string
  maxTokens?:   number
}

export interface ExtractionResult {
  raw:        string    // raw text from the model
  model:      string    // deployment name used
  tokensUsed: number
}

// ─── Single-role extraction ───────────────────────────────────────────────────

/** Call the Foundry deployment for `role`, degrade to CHEAP_GENERAL if budget exceeded. */
export async function extractFieldsWithRole(
  role:    ModelRole,
  req:     ExtractionRequest,
  budget?: RoutingBudget,
): Promise<ExtractionResult> {
  // Degrade heavy roles to cheaper alternatives when budget is blown
  const effectiveRole: ModelRole =
    budget?.degraded && (role === 'GROUNDED_CITED' || role === 'VISION')
      ? 'CHEAP_GENERAL'
      : role

  const deployment = resolveDeployment(effectiveRole)
  const maxTok     = req.maxTokens ?? 4096

  if (budget?.degraded && effectiveRole !== role) {
    budget.warnings.push(
      `Degraded: ${role} → ${effectiveRole} (${deployment.deploymentName}) due to budget ceiling.`,
    )
  }

  if (deployment.sdkFamily === 'anthropic') {
    const client = makeAnthropicClient()
    const msg = await client.messages.create({
      model:      deployment.deploymentName,
      max_tokens: maxTok,
      system:     req.systemPrompt,
      messages:   [{ role: 'user', content: req.userPrompt }],
    })
    const raw    = msg.content.map(b => (b.type === 'text' ? b.text : '')).join('')
    const tokens = msg.usage.input_tokens + msg.usage.output_tokens
    if (budget) trackUsage(budget, tokens, deployment.deploymentName)
    return { raw, model: deployment.deploymentName, tokensUsed: tokens }
  }

  // openai family — raw fetch
  const { content, tokens } = await openAiChat(
    deployment.deploymentName,
    [
      { role: 'system', content: req.systemPrompt },
      { role: 'user',   content: req.userPrompt },
    ],
    maxTok,
  )
  if (budget) trackUsage(budget, tokens, deployment.deploymentName)
  return { raw: content, model: deployment.deploymentName, tokensUsed: tokens }
}

// ─── Dual-family ensemble + haiku adjudication ────────────────────────────────

// Simple structured extraction result used internally by the ensemble.
// The caller is responsible for parsing `raw` into domain fields.
export interface EnsemblePass {
  opusResult:   ExtractionResult
  gptResult:    ExtractionResult
  adjudication: ExtractionResult   // haiku-4-5 resolving disagreements
}

/** Per-field extraction unit for the ensemble adjudicator. */
export interface FieldCandidate {
  fieldPath:  string
  fieldLabel: string
  prompt:     string     // targeted extraction prompt for this field
  maxTokens?: number
}

/** Per-field ensemble output including disagreement tracking. */
export interface EnsembleFieldResult {
  fieldPath:            string
  fieldLabel:           string
  opusRaw:              string
  gptRaw:               string
  adjudicatedRaw:       string
  calibratedConfidence: number
  disagreed:            boolean
}

/**
 * Run dual-family extraction (opus-4-8 + gpt-5.1) on `systemPrompt + userPrompt`,
 * then adjudicate field-level disagreements with haiku-4-5.
 *
 * Confidence is calibrated from agreement — 1.0 when both models return the same
 * text (trimmed), 0.0 when completely different, interpolated for partial matches.
 *
 * The adjudication prompt only fires for fields where the two primary models
 * disagreed, which keeps haiku cost proportional to the amount of ambiguity.
 */
export async function ensembleExtract(
  fields:  FieldCandidate[],
  budget?: RoutingBudget,
): Promise<{ results: EnsembleFieldResult[]; disagreements: FieldDisagreement[] }> {
  const results:       EnsembleFieldResult[] = []
  const disagreements: FieldDisagreement[]   = []

  for (const field of fields) {
    const req: ExtractionRequest = {
      systemPrompt: 'Extract the requested field value from the provided rate filing text. ' +
                    'Return ONLY the extracted value — no explanation, no preamble.',
      userPrompt:   field.prompt,
      maxTokens:    field.maxTokens ?? 512,
    }

    // Primary extraction — two independent model families
    const [opusResult, gptResult] = await Promise.all([
      extractFieldsWithRole('GROUNDED_CITED', req, budget),
      extractFieldsWithRole('VISION',         req, budget),
    ])

    const opusTrimmed = opusResult.raw.trim()
    const gptTrimmed  = gptResult.raw.trim()
    const agreed      = opusTrimmed === gptTrimmed

    // Calibrated confidence: 1.0 on exact agreement, else Jaccard on char-level tokens
    const calibratedConfidence = agreed ? 1.0 : jaccardSimilarity(opusTrimmed, gptTrimmed)
    const disagreed            = calibratedConfidence < 0.85

    let adjudicatedRaw = agreed ? opusTrimmed : ''

    if (disagreed) {
      // Third-family adjudication — haiku resolves the disagreement
      const adjReq: ExtractionRequest = {
        systemPrompt: 'You are an adjudicator. Two models extracted a value and disagreed. ' +
                      'Choose the more likely correct value based on context. ' +
                      'Return ONLY the chosen value — no explanation.',
        userPrompt:   `Field: ${field.fieldLabel}\n` +
                      `Model A extracted: ${opusTrimmed}\n` +
                      `Model B extracted: ${gptTrimmed}\n` +
                      `Context: ${field.prompt}`,
        maxTokens:    field.maxTokens ?? 512,
      }
      const adjResult = await extractFieldsWithRole('BULK_VERIFY', adjReq, budget)
      adjudicatedRaw  = adjResult.raw.trim()

      disagreements.push({
        fieldPath:            field.fieldPath,
        fieldLabel:           field.fieldLabel,
        opusValue:            opusTrimmed,
        gptValue:             gptTrimmed,
        adjudicatedValue:     adjudicatedRaw,
        calibratedConfidence,
      })
    } else {
      // Models agreed or near-agreed — use opus as canonical (it has grounded citations)
      adjudicatedRaw = opusTrimmed
    }

    results.push({
      fieldPath:            field.fieldPath,
      fieldLabel:           field.fieldLabel,
      opusRaw:              opusTrimmed,
      gptRaw:               gptTrimmed,
      adjudicatedRaw,
      calibratedConfidence,
      disagreed,
    })
  }

  return { results, disagreements }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Jaccard similarity on word-level tokens (0–1). */
function jaccardSimilarity(a: string, b: string): number {
  const tokA = new Set(a.split(/\s+/).filter(Boolean))
  const tokB = new Set(b.split(/\s+/).filter(Boolean))
  if (tokA.size === 0 && tokB.size === 0) return 1
  if (tokA.size === 0 || tokB.size === 0) return 0
  let intersection = 0
  tokA.forEach(t => { if (tokB.has(t)) intersection++ })
  const union = tokA.size + tokB.size - intersection
  return union === 0 ? 1 : intersection / union
}
