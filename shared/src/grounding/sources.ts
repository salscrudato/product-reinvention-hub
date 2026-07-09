// sources.ts — grounding guards for AI-surfaced EXTERNAL sources (the news scout).
// A model that free-invents a source URL must never have it persisted as real news.
// Two pure helpers enforce that:
//   • sanitizeNewsUrl — a SHAPE gate: only well-formed http(s) URLs with a real host
//     survive; bare schemes, javascript:/ftp:, and non-URLs are rejected outright.
//   • verifyItems     — an EXISTENCE gate: each item's URL is checked via an injected
//     liveness probe and dropped if it doesn't resolve. The probe (a network HEAD) lives
//     in functions/src/news.ts; injecting it keeps this logic unit-testable offline.
//
// Pure TypeScript (zero platform imports) so functions/ reuses it AND the gate exercises
// the drop behaviour deterministically with a stubbed probe. See functions/src/news.ts.

/** Return the URL if it is a well-formed http(s) URL with a dotted host, else null.
 *  Deliberately strict: rejects bare schemes ("http://"), non-http schemes
 *  ("ftp://", "javascript:…"), whitespace, and anything that isn't a URL. */
export function sanitizeNewsUrl(raw: string): string | null {
  const s = (raw ?? '').trim()
  if (!s || /\s/.test(s)) return null
  if (!/^https?:\/\/[^/\s]+\.[^/\s]+/i.test(s)) return null
  return s
}

/** Keep only items whose URL passes the shape gate AND resolves via `isLive`.
 *  Shape-gate is applied first (sync), then existence-probes run in parallel; the
 *  surviving items carry their sanitized URL. */
export async function verifyItems<T extends { url: string }>(
  items: readonly T[],
  isLive: (url: string) => Promise<boolean>,
): Promise<T[]> {
  const gated = items
    .map(it => ({ it, url: sanitizeNewsUrl(it.url) }))
    .filter((g): g is { it: T; url: string } => g.url !== null)
  const alive = await Promise.all(gated.map(g => isLive(g.url)))   // Promise<boolean>[] — no generic unwrap
  const out: T[] = []
  gated.forEach((g, i) => { if (alive[i]) out.push({ ...g.it, url: g.url }) })
  return out
}
