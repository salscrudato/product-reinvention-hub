// notices.ts — the single, canonical source of AI-status copy for every SSE surface.
//
// The server tags each `notice` SSE frame with a machine-readable `kind` (see
// functions/src/runtime.ts `StreamEvent`). The CLIENT owns the wording here so it can
// never drift across Home / Claims / rule composer / scaffold / filing import: each
// surface renders the SAME sentence for the SAME situation. `message` (server-authored)
// is only a fallback for kinds whose copy is dynamic (unverified — it names the refs) or
// unknown to an older client.
//
// Every line answers three things the prompt requires: WHAT happened, WHAT it means for
// this answer, and that REGENERATE retries at full depth when budget allows.

export type NoticeKind = 'degrade' | 'deny' | 'breaker' | 'cached' | 'unverified'
export type NoticeLevel = 'info' | 'warn'

export interface NoticeEvent {
  level:   NoticeLevel
  message: string
  kind?:   NoticeKind
  refs?:   string[]
}

export interface ResolvedNotice {
  level:  NoticeLevel
  title:  string
  detail: string
}

// Static canonical copy. Budget resets on the rolling UTC day (see functions/src/costGuard).
const CANONICAL: Record<Exclude<NoticeKind, 'unverified'>, ResolvedNotice> = {
  degrade: {
    level: 'info',
    title: 'Reduced-depth answer',
    detail:
      'The AI budget for this session is running low, so this reply used a lighter path. ' +
      'Regenerate retries at full depth when budget is available.',
  },
  deny: {
    level: 'warn',
    title: 'AI paused for today',
    detail:
      'The daily AI budget ceiling has been reached, so no new answer was generated. ' +
      'It resets at 00:00 UTC. Regenerate will run at full depth once budget is available.',
  },
  breaker: {
    level: 'warn',
    title: 'AI temporarily unavailable',
    detail:
      'The AI service hit repeated errors and is cooling down for a moment. ' +
      'Regenerate to retry at full depth shortly.',
  },
  cached: {
    level: 'info',
    title: 'Answered from cache',
    detail:
      'This reused a near-identical earlier answer to save budget — it is still grounded and cited. ' +
      'Regenerate for a fresh, full-depth response.',
  },
}

/** Resolve any notice frame to client-owned, drift-proof copy. */
export function resolveNotice(ev: NoticeEvent): ResolvedNotice {
  if (ev.kind && ev.kind !== 'unverified') return CANONICAL[ev.kind]
  if (ev.kind === 'unverified') {
    // Dynamic — the server message names the specific unverified refs; keep it as the detail.
    return { level: 'warn', title: 'Unverified citation', detail: ev.message }
  }
  // Unknown / untagged (older server): trust the server message under a neutral heading.
  return { level: ev.level, title: ev.level === 'warn' ? 'Heads up' : 'Note', detail: ev.message }
}

/** A cache-hit is surfaced as a quiet badge (not a banner) beside the Regenerate control. */
export function isCacheNotice(ev: NoticeEvent | null | undefined): boolean {
  return ev?.kind === 'cached'
}
