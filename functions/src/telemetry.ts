// telemetry.ts — per-call AI usage recording.
// Every Anthropic call in this project calls recordUsage() so cost, token
// volume, cache efficiency, and error rate are visible in the Admin AI Cost tab.
//
// Why NOT through mutate():
//   aiUsage is operational telemetry, not a domain entity. It has no governance
//   fields (status/lifecycle/rev), no search-index entry, and no field-level diff
//   history. mutate() would add 4–5 extra Firestore writes per record; at AI call
//   frequency that overhead is both unnecessary and expensive. The collection is
//   append-only and write-once, making optimistic concurrency irrelevant. This
//   record IS the audit trail for AI spend — writing it through the audit layer
//   would be circular. Errors are caught-and-continued so a telemetry failure
//   never surfaces to the user.
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { MODEL, MODEL_FAST } from './runtime'

// ─── Pricing table — single source of truth ───────────────────────────────────
// Rates: USD per million tokens (Anthropic public pricing).
// cache_read_input_tokens:     0.1× the input rate (Anthropic standard).
// cache_creation_input_tokens: 2.0× the input rate — we set an explicit 1h TTL on every
//   cache breakpoint (runtime.CACHE_1H), and a 1-hour cache write bills at 2× input
//   (5-minute writes are 1.25×). SDK 0.54 does not split the usage into 5m/1h buckets, and
//   every breakpoint we write is 1h, so pricing writes uniformly at the 1h rate is exact.
// Update this table when Anthropic changes prices; all cost estimates flow from here.
const PRICING: Record<string, {
  inputPerMTok:      number
  outputPerMTok:     number
  cacheReadPerMTok:  number  // 0.1 × input
  cacheWritePerMTok: number  // 2.0 × input (1h TTL)
}> = {
  'claude-sonnet-5': {
    inputPerMTok:       3.00,
    outputPerMTok:     15.00,
    cacheReadPerMTok:   0.30,
    cacheWritePerMTok:  6.00,
  },
  'claude-haiku-4-5': {
    inputPerMTok:       0.80,
    outputPerMTok:      4.00,
    cacheReadPerMTok:   0.08,
    cacheWritePerMTok:  1.60,
  },
}

// ─── Usage accumulator ────────────────────────────────────────────────────────

/** Mutable accumulator: pass to runChatAgent / runSection so per-turn usage
 *  rolls up into a single record for the full feature invocation. */
export interface UsageAccum {
  input_tokens:                number
  output_tokens:               number
  cache_read_input_tokens:     number
  cache_creation_input_tokens: number
}

export function emptyUsage(): UsageAccum {
  return { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
}

/** Add SDK usage (from Message.usage) into the accumulator. Nulls are treated as 0. */
export function addUsage(accum: UsageAccum, u: {
  input_tokens?:                number | null
  output_tokens?:               number | null
  cache_read_input_tokens?:     number | null
  cache_creation_input_tokens?: number | null
}): void {
  accum.input_tokens                += u.input_tokens                ?? 0
  accum.output_tokens               += u.output_tokens               ?? 0
  accum.cache_read_input_tokens     += u.cache_read_input_tokens     ?? 0
  accum.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0
}

/** Compute estimated USD cost from a usage snapshot and a model id. */
export function estimateCost(model: string, u: UsageAccum): number {
  const p = PRICING[model] ?? PRICING['claude-sonnet-5']!
  const M = 1_000_000
  return (
    (u.input_tokens                / M) * p.inputPerMTok      +
    (u.output_tokens               / M) * p.outputPerMTok     +
    (u.cache_read_input_tokens     / M) * p.cacheReadPerMTok  +
    (u.cache_creation_input_tokens / M) * p.cacheWritePerMTok
  )
}

// ─── Persistence ──────────────────────────────────────────────────────────────

/** Append one usage record to aiUsage via Admin SDK. Fire-and-forget: any write
 *  failure is logged and suppressed so telemetry never breaks a user-facing call.
 *
 *  `tier` + `escalated` power the cheap-first-cascade observability in the Admin AI Cost
 *  tab (P-B6): `tier` splits cheap (haiku) vs strong (sonnet) spend; `escalated` marks a
 *  strong record produced because a cheap pass failed its verifier check. Both default
 *  sensibly (tier by model, escalated=false), so non-cascade call sites need no change. */
export async function recordUsage(params: {
  feature:    string   // 'chat' | 'draftRule' | 'scaffoldProduct' | etc.
  model:      string
  usage:      UsageAccum
  latencyMs:  number
  ok:         boolean  // false if the AI call threw before completing
  tier?:      'cheap' | 'strong'  // defaults: MODEL_FAST → cheap, else strong
  escalated?: boolean             // true for a strong record from a failed cheap check
}): Promise<void> {
  try {
    await getFirestore().collection('aiUsage').add({
      feature:          params.feature,
      model:            params.model,
      inputTokens:      params.usage.input_tokens,
      outputTokens:     params.usage.output_tokens,
      cacheReadTokens:  params.usage.cache_read_input_tokens,
      cacheWriteTokens: params.usage.cache_creation_input_tokens,
      latencyMs:        params.latencyMs,
      ok:               params.ok,
      tier:             params.tier ?? (params.model === MODEL_FAST ? 'cheap' : 'strong'),
      escalated:        params.escalated ?? false,
      estimatedUsd:     estimateCost(params.model, params.usage),
      at:               FieldValue.serverTimestamp(),
    })
  } catch {
    console.warn('[telemetry] Failed to record AI usage — continuing')
  }
}

/**
 * Record a cheap-first cascade as up to two usage records with an accurate per-model
 * token/cost split: always one `cheap` record (the haiku first pass), and — only when the
 * cheap verifier check failed and we escalated — one `strong` record (the sonnet pass)
 * flagged `escalated`. The Admin tab then computes per-feature escalation rate as
 * (strong-escalated records ÷ cheap records), which climbs toward 1 exactly in the known
 * failure mode (a drifting verifier escalating everything) and trips the cost alarm.
 * Never blend the two models' tokens into one record — they price differently.
 */
export async function recordCascade(params: {
  feature:          string
  cheapUsage:       UsageAccum
  cheapLatencyMs:   number
  ok:               boolean
  strongUsage?:     UsageAccum   // present iff we escalated to the strong model
  strongLatencyMs?: number
}): Promise<void> {
  await recordUsage({
    feature: params.feature, model: MODEL_FAST, usage: params.cheapUsage,
    latencyMs: params.cheapLatencyMs, ok: params.ok, tier: 'cheap', escalated: false,
  })
  if (params.strongUsage) {
    await recordUsage({
      feature: params.feature, model: MODEL, usage: params.strongUsage,
      latencyMs: params.strongLatencyMs ?? 0, ok: params.ok, tier: 'strong', escalated: true,
    })
  }
}
