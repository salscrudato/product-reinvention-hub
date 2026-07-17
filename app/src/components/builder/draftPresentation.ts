// draftPresentation.ts — pure presentation derivations for the Drafts workbench
// (P3 tasks 1 + 3). No I/O, no adapter: everything renders from the row the seam
// already returns (including the server-derived identity/readiness projections).
import type { DraftIdentity } from '../../lib/backend'

// Titles that carry no identity — the workbook importer historically named every
// product doc "Core", which is how nine indistinguishable cards happened.
const PLACEHOLDER_NAMES = new Set(['core', 'untitled', 'product', 'new product', 'draft'])

export interface DraftTitleSource {
  name?: unknown
  identity?: DraftIdentity | null
  lineage?: unknown
  updatedAt?: unknown
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

// UTC like the server's identity projection (portfolio.ts monthDay) — the card's
// fallback date must never disagree with a displayName built for the same instant.
function monthDay(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** Card title truth (task 1): the server-derived displayName whenever the draft has a
 *  source file (so the placeholder "Core" is unreachable for any imported draft); a
 *  real hand-given name otherwise; and an honest "Untitled draft – Mon DD" for legacy
 *  placeholder-named drafts — never a bare "Core" again. */
export function draftTitle(row: DraftTitleSource): string {
  const idn = row.identity
  if (idn?.sourceFileName && idn.displayName) return idn.displayName
  const name = str(row.name)
  if (name && !PLACEHOLDER_NAMES.has(name.toLowerCase())) return name
  const lineageAt = str((row.lineage as { at?: unknown } | null | undefined)?.at)
  const md = monthDay(lineageAt ?? str(row.updatedAt))
  return md ? `Untitled draft – ${md}` : 'Untitled draft'
}

/** Relative timestamp: "just now" / "12m ago" / "3h ago" / "5d ago", falling back to
 *  "Mon DD" beyond two weeks. Deterministic given `now` (injectable for tests). */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const s = Math.max(0, Math.floor((now - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 14) return `${d}d ago`
  return monthDay(iso)
}

/** Labeled count with thousands separators (task 3): "1,359 forms", "1 coverage";
 *  an unknown count renders an em-dash, never a fake zero. */
export function countLabel(n: number | undefined, singular: string, plural: string): string {
  if (n === undefined) return `— ${plural}`
  return `${n.toLocaleString('en-US')} ${n === 1 ? singular : plural}`
}
