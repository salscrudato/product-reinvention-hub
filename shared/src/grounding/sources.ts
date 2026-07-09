// sources.ts — grounding guards for AI-surfaced EXTERNAL sources (the news scout).
// A model that free-invents a source URL must never have it persisted as real news.
// Three pure helpers enforce that:
//   • sanitizeNewsUrl  — a SHAPE gate: only well-formed http(s) URLs with a real host
//     survive; bare schemes, javascript:/ftp:, and non-URLs are rejected outright.
//   • verifyItems      — an EXISTENCE gate: each item's URL is checked via an injected
//     liveness probe and dropped if it doesn't resolve. The probe (a network HEAD) lives
//     in functions/src/news.ts; injecting it keeps this logic unit-testable offline.
//   • extractOgImage   — parses og:image / twitter:image from raw HTML; pure string
//     matching (no network, no DOM) so it is safe in shared/ and testable offline.
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

/** Parse <meta property="og:image"> (falling back to twitter:image) from raw HTML.
 * Covers both attribute orderings. Returns the raw content value so the caller can
 * validate it with sanitizeNewsUrl. Returns null when no matching tag is found. */
export function extractOgImage(html: string): string | null {
  // Four patterns cover property-before-content and content-before-property for each tag.
  const patterns: RegExp[] = [
    /<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*\/?>/i,
    /<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*\/?>/i,
    /<meta\s+[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["'][^>]*\/?>/i,
    /<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["'][^>]*\/?>/i,
  ]
  for (const re of patterns) {
    const m = re.exec(html)
    const v = m?.[1]?.trim()
    if (v) return v
  }
  return null
}

/** Extract the first plausible inline <img> src from raw HTML.
 *  Returns the raw src value; caller must sanitize and resolve relative URLs.
 *  "Plausible" = has width OR height attribute >= 200, or no dimension attrs at all
 *  (many real hero images omit dimensions). Skips obvious tracking pixels. */
export function extractInlineImage(html: string): string | null {
  // Match <img> tags with src, capturing the full tag to inspect dimension attributes.
  const imgPattern = /<img\s+[^>]*src=["']([^"']+)["'][^>]*\/?>/gi
  let match: RegExpExecArray | null
  while ((match = imgPattern.exec(html)) !== null) {
    const fullTag = match[0]!
    const src     = match[1]?.trim()
    if (!src) continue

    // Extract width and height if present (handles both width="300" and width='300').
    const widthMatch  = /\bwidth=["']?(\d+)["']?/i.exec(fullTag)
    const heightMatch = /\bheight=["']?(\d+)["']?/i.exec(fullTag)
    const w = widthMatch  ? parseInt(widthMatch[1]!,  10) : null
    const h = heightMatch ? parseInt(heightMatch[1]!, 10) : null

    // Skip obvious tracking pixels (dimension < 10).
    if ((w !== null && w < 10) || (h !== null && h < 10)) continue

    // Keep if no dimensions specified OR at least one dimension >= 200.
    if ((w === null && h === null) || (w !== null && w >= 200) || (h !== null && h >= 200)) {
      return src
    }
  }
  return null
}

/** Resolve a potentially relative URL against a base origin.
 *  Returns the absolute URL if valid, else null. */
export function resolveImageUrl(candidate: string, baseUrl: string): string | null {
  // A real image URL — absolute, root-relative or protocol-relative — never contains raw
  // whitespace. Reject it up front (mirrors sanitizeNewsUrl's gate): the WHATWG URL parser
  // would otherwise silently percent-encode the space and resolve e.g. "not a url" to a bogus
  // <base>/not%20a%20url rather than throwing — and that encoded href slips past the later
  // sanitizeNewsUrl whitespace check too.
  const c = (candidate ?? '').trim()
  if (!c || /\s/.test(c)) return null
  try {
    const base = new URL(baseUrl)
    const resolved = new URL(c, base)
    return resolved.href
  } catch {
    return null
  }
}

/** Derive a deterministic hex color from a seed string (source name).
 *  Simple hash → hue → saturated, medium-lightness color. */
export function deterministicColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) | 0
  const hue = Math.abs(h) % 360
  // HSL: saturated color (70% saturation, 50% lightness) for brand-like appearance.
  const s = 70, l = 50
  // Convert HSL to RGB (simple algorithm).
  const c = (1 - Math.abs(2 * l / 100 - 1)) * (s / 100)
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l / 100 - c / 2
  let r = 0, g = 0, b = 0
  if (hue < 60)       { r = c; g = x; b = 0 }
  else if (hue < 120) { r = x; g = c; b = 0 }
  else if (hue < 180) { r = 0; g = c; b = x }
  else if (hue < 240) { r = 0; g = x; b = c }
  else if (hue < 300) { r = x; g = 0; b = c }
  else                { r = c; g = 0; b = x }
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
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
