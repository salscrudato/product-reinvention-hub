// portfolio.ts — pure read-model derivations for the P2 "server truth" surfaces:
// draft identity, dedup matches, portfolio pulse, and deterministic suggested
// queries. Pure, platform-import-free — consumed by the app via the @pf/shared
// barrel and by the server via server/lib/platform-shared.cjs (pnpm build:platform).
//
// Everything here derives from data that is ALREADY PERSISTED on entities
// (lineage, lob, lifecycle/lifecycleState, reviewStatus, states, tasks.done).
// Nothing re-runs an import stage and nothing writes. Draft identity is a
// read-time projection — legacy drafts need no migration.
//
// Per-draft readiness (P3 closes the P2 storage gap): the import-apply write
// side now stamps a bounded `data.readiness` summary (ReadinessSummary below)
// derived from the bundle's stage-5/6/7 outputs at the moment the user applies
// the plan. deriveDraftReadiness() projects it read-time, exactly like
// identity — legacy drafts (no summary) get a null-verdict projection and are
// NOT blocked (flag-not-invent: absence of evidence never fabricates a
// blocker). NOTE: no citation resolved/total ratio exists anywhere in the
// pipeline — the honest citation numbers are the bundle conservation counts
// (proposed = accepted + unresolved), so that is what is persisted.

// ─── Draft identity (task 1) ─────────────────────────────────────────────────

export interface DraftIdentity {
  /** "[artifactBase] - [LOB] - [Mon DD]", built from whichever parts exist; null when the entity has no file lineage. */
  displayName: string | null
  /** First `file`-typed lineage source ref (the uploaded artifact), or null. */
  sourceFileName: string | null
  /** lineage.at when lineage.kind === 'IMPORT' (ISO string), or null. */
  importedAt: string | null
  /** data.contentHash when the write side stamps it; null for every draft persisted before that exists. */
  contentHash: string | null
}

export interface DraftDedupMatch {
  id: string
  displayName: string | null
  importedAt: string | null
  /** Lifecycle-ish status of the matching draft (lifecycle, else lifecycleState), or null. */
  status: string | null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Mon DD" from an ISO timestamp, UTC (deterministic across server timezones); null if unparsable. */
function monthDay(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/** Filename → artifact base: strip any directory prefix and the final extension. */
function artifactBaseOf(fileName: string): string {
  const leaf = fileName.split(/[\\/]/).pop() ?? fileName
  const dot = leaf.lastIndexOf('.')
  return (dot > 0 ? leaf.slice(0, dot) : leaf).trim()
}

function lobRefOf(lob: unknown): string | null {
  if (typeof lob === 'string' && lob) return lob
  if (lob && typeof lob === 'object') {
    const ref = (lob as { refId?: unknown }).refId
    if (typeof ref === 'string' && ref) return ref
  }
  return null
}

/** The persisted fields the identity projection reads — loose (Cosmos data is untyped). */
export interface DraftIdentitySource {
  lineage?: unknown
  lob?: unknown
  contentHash?: unknown
}

/** Loose-in (Cosmos data is untyped), strict-out. Reads only persisted fields. */
export function deriveDraftIdentity(data: DraftIdentitySource | null | undefined): DraftIdentity {
  const lineage = (data?.lineage ?? null) as { kind?: unknown; at?: unknown; sources?: unknown } | null
  const sources = Array.isArray(lineage?.sources) ? (lineage!.sources as Array<{ type?: unknown; ref?: unknown }>) : []
  const fileRef = sources.find((s) => s?.type === 'file' && typeof s.ref === 'string' && s.ref)?.ref as string | undefined
  const sourceFileName = fileRef ?? null
  const importedAt = lineage?.kind === 'IMPORT' && typeof lineage.at === 'string' && lineage.at ? lineage.at : null
  const contentHash = typeof data?.contentHash === 'string' && data.contentHash ? data.contentHash : null
  const parts = sourceFileName
    ? [artifactBaseOf(sourceFileName), lobRefOf(data?.lob), monthDay(importedAt)].filter((p): p is string => !!p)
    : []
  return { displayName: parts.length ? parts.join(' - ') : null, sourceFileName, importedAt, contentHash }
}

// ─── Draft readiness (P3) ────────────────────────────────────────────────────

/** Persisted on the product doc as `data.readiness` by the import-apply write
 *  side (client, through the atomic mutate envelope). Bounded and versioned —
 *  a summary of the bundle's stage-5/6/7 outputs, never the whole bundle.
 *  SEMANTICS: it describes the IMPORT RUN's citation governance (what the source
 *  established, what stayed unresolved), not the subset of sections the reviewer
 *  chose to write — deselecting a section changes what lands in the draft, not
 *  what the run proved about the source. WRITE-ONCE: the envelope refuses any
 *  later mutation of the field (READINESS_IMMUTABLE), so the promote verdict can
 *  never be laundered by re-stamping a clean summary. */
export interface ReadinessSummary {
  v: 1
  /** Bundle conservation counts (proposed = accepted + unresolved); null for
   *  local XLSX imports, which never run the citation pipeline. */
  counts: { proposed: number; accepted: number; unresolved: number } | null
  /** Verbatim reasons of BLOCKING unresolved items (bounded by the writer). */
  blockers: string[]
  /** fail = blocking items present; warn = unresolved items or import warnings; pass = clean. */
  validation: 'pass' | 'warn' | 'fail'
  /** Stage-6 import-warning count. */
  importWarnings: number
  /** Stage-7 completeness assessment (e.g. COMPLETE, PARTIAL, EMPTY), when produced. */
  completeness: string | null
}

/** Read-time readiness projection for a draft row. The server verdict —
 *  `promotable` here and the promote 409 — derives ONLY from persisted data;
 *  clients render it, never recompute it. */
export interface DraftReadiness {
  /** Citation-governance counts from the persisted summary, or null (legacy draft / local import). */
  citations: { accepted: number; unresolved: number } | null
  /** Verbatim blocker reasons; empty when nothing blocks. */
  blockers: string[]
  /** Persisted validation verdict, or null when no summary exists. */
  validation: 'pass' | 'warn' | 'fail' | null
  /** Server-computed promote verdict: false only when persisted evidence blocks. */
  promotable: boolean
  /** 'summary' = derived from a persisted import summary; 'none' = no data (no verdict — nothing blocks). */
  source: 'summary' | 'none'
}

const NO_READINESS: DraftReadiness = { citations: null, blockers: [], validation: null, promotable: true, source: 'none' }

const isValidation = (v: unknown): v is 'pass' | 'warn' | 'fail' => v === 'pass' || v === 'warn' || v === 'fail'
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)

/** Loose-in (Cosmos data is untyped), strict-out. Reads only the persisted
 *  `data.readiness` summary; never throws on legacy/malformed rows. */
export function deriveDraftReadiness(data: { readiness?: unknown } | null | undefined): DraftReadiness {
  const raw = data?.readiness
  if (!raw || typeof raw !== 'object') return NO_READINESS
  const s = raw as Partial<ReadinessSummary> & { counts?: unknown; blockers?: unknown }
  if (s.v !== 1 || !isValidation(s.validation)) return NO_READINESS
  const blockers = Array.isArray(s.blockers)
    ? (s.blockers as unknown[]).filter((b): b is string => typeof b === 'string' && b.length > 0)
    : []
  const c = s.counts && typeof s.counts === 'object'
    ? { accepted: count((s.counts as { accepted?: unknown }).accepted), unresolved: count((s.counts as { unresolved?: unknown }).unresolved) }
    : null
  return {
    citations: c,
    blockers,
    validation: s.validation,
    promotable: blockers.length === 0 && s.validation !== 'fail',
    source: 'summary',
  }
}

// ─── Portfolio pulse (task 5) ────────────────────────────────────────────────

/** One product row as fetched by the pulse query — persisted fields only. */
export interface PulseProductRow {
  id: string
  name?: unknown
  lifecycle?: unknown
  lifecycleState?: unknown
  reviewStatus?: unknown
  states?: unknown
  allStates?: unknown
  lob?: unknown
  lineage?: unknown
}

export interface PulseTaskRow { done?: unknown }

export interface PortfolioPulse {
  liveProducts: number
  statesCovered: number
  draftsAwaitingReview: number
  /** Latest persisted import (from lineage). status is always 'applied' — only applied
   *  imports persist; in-flight/failed runs are not stored (recorded storage delta). */
  lastImport: { status: 'applied'; at: string; artifact: string | null } | null
  openTasks: number
}

/** 50 states + DC — what `allStates: true` expands to for the coverage count. */
export const ALL_STATES_COUNT = 51

const isDraftRow = (p: PulseProductRow) => p.lifecycle === 'DRAFT' || p.lifecycleState === 'draft'
const isLiveRow = (p: PulseProductRow) => p.lifecycle === 'LAUNCHED'

export function computePortfolioPulse(products: PulseProductRow[], tasks: PulseTaskRow[]): PortfolioPulse {
  const live = products.filter(isLiveRow)
  let statesCovered: number
  if (live.some((p) => p.allStates === true)) {
    statesCovered = ALL_STATES_COUNT
  } else {
    const seen = new Set<string>()
    for (const p of live) {
      if (!Array.isArray(p.states)) continue
      for (const s of p.states) if (typeof s === 'string' && s) seen.add(s.toUpperCase())
    }
    statesCovered = seen.size
  }
  const draftsAwaitingReview = products.filter((p) => isDraftRow(p) && p.reviewStatus !== 'APPROVED').length

  let lastImport: PortfolioPulse['lastImport'] = null
  for (const p of products) {
    const idn = deriveDraftIdentity(p)
    if (!idn.importedAt) continue
    if (!lastImport || idn.importedAt > lastImport.at) {
      lastImport = { status: 'applied', at: idn.importedAt, artifact: idn.sourceFileName }
    }
  }

  return {
    liveProducts: live.length,
    statesCovered,
    draftsAwaitingReview,
    lastImport,
    openTasks: tasks.filter((t) => t.done !== true).length,
  }
}

// ─── Suggested queries (task 6) ──────────────────────────────────────────────

/** One coverage row for the forms-gap fact — persisted fields only. */
export interface SuggestedQueryCoverageRow {
  name?: unknown
  productName?: unknown
  formNumbers?: unknown
}

// Fallback pool: appended (in order) until at least MIN queries exist. Static
// strings — same input, same output, always.
const FALLBACK_QUERIES = [
  'Summarize my portfolio by line of business and state coverage.',
  'Which live products changed most recently, and what changed?',
  'Where are the coverage gaps across my portfolio?',
] as const
const MIN_QUERIES = 3
const MAX_QUERIES = 4

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/**
 * 3–4 deterministic copilot query strings templated from real portfolio facts.
 * All candidate lists are sorted before picking, so input ORDER never changes
 * the output — same portfolio, same strings.
 */
export function buildSuggestedQueries(products: PulseProductRow[], coverages: SuggestedQueryCoverageRow[]): string[] {
  const queries: string[] = []

  // Fact 1: a live product covering 2+ states → a state-to-state rate compare.
  const multiState = products
    .filter((p) => isLiveRow(p) && Array.isArray(p.states) && p.states.filter((s) => typeof s === 'string' && s).length >= 2 && str(p.name))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
  if (multiState.length) {
    const p = multiState[0]
    const [s1, s2] = (p.states as string[]).filter((s) => typeof s === 'string' && s).map((s) => s.toUpperCase()).sort()
    queries.push(`How does ${str(p.name)} differ between ${s1} and ${s2}?`)
  }

  // Fact 2: a coverage with no forms attached → a forms-gap question.
  const bare = coverages
    .filter((c) => str(c.name) && Array.isArray(c.formNumbers) && c.formNumbers.length === 0)
    .sort((a, b) => `${str(a.productName) ?? ''}|${str(a.name)}`.localeCompare(`${str(b.productName) ?? ''}|${str(b.name)}`))
  if (bare.length) {
    const c = bare[0]
    const where = str(c.productName) ? ` in ${str(c.productName)}` : ''
    queries.push(`Which forms should attach to ${str(c.name)}${where}?`)
  }

  // Fact 3: drafts awaiting review → a triage question.
  const awaiting = products.filter((p) => isDraftRow(p) && p.reviewStatus !== 'APPROVED').length
  if (awaiting > 0) {
    queries.push(`What should I review first across my ${awaiting} draft product${awaiting === 1 ? '' : 's'} awaiting review?`)
  }

  for (const f of FALLBACK_QUERIES) {
    if (queries.length >= MIN_QUERIES) break
    queries.push(f)
  }
  return queries.slice(0, MAX_QUERIES)
}

// ─── Tenant derivation (task 7) — wire types for the seam ───────────────────

/** Response of POST /api/auth/resolve. IDENTICAL shape for every well-formed
 *  email — the hint is derived config (domain map or domain-minus-TLD), never a
 *  data-store assertion, so the endpoint cannot enumerate accounts or tenants. */
export interface TenantResolveResult {
  mode: 'sso' | 'password'
  tenantHint: string
}

/** One row of GET /api/auth/memberships (the caller's own tenants). */
export interface TenantMembership {
  tenantId: string
  name: string
  /** True for the tenant the current session's JWT is scoped to. */
  current: boolean
}
