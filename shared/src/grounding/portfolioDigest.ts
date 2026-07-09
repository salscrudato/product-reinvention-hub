// portfolioDigest.ts — the pure, deterministic assembler for the chat "portfolio digest":
// a compact, budget-bounded fast-facts block the chat endpoint injects into its STABLE
// system prefix. It lets the model answer portfolio-shape questions ("what products /
// coverages / forms / rules exist", the rating headline) WITHOUT a tool round-trip — while
// still citing [refId] / [form number]. It never invents: every token it emits is copied
// verbatim from its input, and the grounding contract still routes any detail to the tools.
//
// Zero platform imports (pure TS). functions/ reads the live Firestore data, computes the
// worked-example premiums, maps them to PortfolioDigestInput and calls this; the gate
// exercises it deterministically with synthetic inputs. See functions/src/portfolioDigest.ts.

/** One product's slice of the digest input. Every refId / form number here is a LIVE value
 *  the caller read from the catalogue — the assembler only ever copies these, never mints them. */
export interface PortfolioDigestProduct {
  refId?:      string | null
  name:        string
  lob?:        string | null                                   // display label, e.g. "Personal Home"
  coverages:   { refId?: string | null; name: string }[]
  formNumbers: string[]
  ruleRefIds:  (string | null | undefined)[]
  /** Worked-example headline per rating program — programRef is a citable refId (e.g. HO.RAT.1). */
  rating?:     { programRef: string; premium: number }[]
}

export interface PortfolioDigestInput {
  products: PortfolioDigestProduct[]
}

export interface PortfolioDigestOptions {
  /** Soft budget in approximate tokens (~4 chars/token). Default DIGEST_TOKEN_BUDGET. */
  tokenBudget?: number
}

/** Default digest budget: ~1.5k tokens — large enough for the whole seed catalogue, small
 *  enough to stay a cheap, always-cached prefix. */
export const DIGEST_TOKEN_BUDGET = 1500

// Per-product caps so one pathological product can't dominate the budget. The global budget
// (below) is the real bound; these keep any single section proportionate + deterministic.
const MAX_COVERAGES = 40
const MAX_FORMS     = 40
const MAX_RULES     = 40

// The stable preamble. It restates the two load-bearing rules INSIDE the digest block so they
// travel with it (cite everything; never invent; tools win). Deliberately BRACKET-FREE except
// the literal "[refId]"/"[form number]" placeholders, which are descriptive (the citation
// verifier ignores non-refId/non-form bracket tokens), so nothing here reads as a fabricated cite.
const PREAMBLE =
  'PORTFOLIO DIGEST — fast facts about the live catalogue, so common "what exists" questions ' +
  'need no tool call. This is a quick index, NOT the full record. The house rules still apply: ' +
  'cite every specific claim with its [refId] or [form number], and never invent coverages, ' +
  'forms, rules, limits or factors. Call the tools for anything not listed here and for any ' +
  'detail (terms, conditions, rating steps). If a tool ever disagrees with this digest, the tool wins.'

/** Approximate token count (~4 chars/token). Deliberately simple + deterministic; used both to
 *  bound the digest during assembly and to assert the budget in tests. */
export function estimateDigestTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// Stable, locale-independent string order (avoids localeCompare's environment variance).
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

// Whitespace-collapse a form number for display; key it (uppercased, space-stripped) for dedupe.
const formDisplay = (n: string): string => n.replace(/\s+/g, ' ').trim()
const formKey     = (n: string): string => n.toUpperCase().replace(/[\s-]+/g, '')

/** Render a "Label: a; b; c" line, sorted + deduped + capped, or '' when there is nothing to show.
 *  A cap overflow appends "+N more (tools)" so the omission is visible and honest. */
function listLine(label: string, items: string[], cap: number): string {
  if (items.length === 0) return ''
  const shown = items.slice(0, cap)
  const extra = items.length - shown.length
  const tail  = extra > 0 ? `; +${extra} more (tools)` : ''
  return `  ${label}: ${shown.join('; ')}${tail}`
}

/** Assemble one product's section as a canonical, deterministic string. */
function renderProduct(p: PortfolioDigestProduct): string {
  const refId = p.refId?.trim()
  const lob   = p.lob?.trim()
  const name  = p.name?.trim() || refId || 'Untitled product'
  const head  = `${name}${lob ? ` — ${lob}` : ''}${refId ? ` [${refId}]` : ''}`

  // Coverages — dedupe by refId (or name when refId is absent), sort by (refId, name).
  const covSeen = new Set<string>()
  const coverages = [...p.coverages]
    .filter(c => {
      const key = (c.refId?.trim() || c.name?.trim() || '').toUpperCase()
      if (!key || covSeen.has(key)) return false
      covSeen.add(key); return true
    })
    .sort((a, b) => cmp(a.refId?.trim() ?? '', b.refId?.trim() ?? '') || cmp(a.name ?? '', b.name ?? ''))
    .map(c => {
      const r = c.refId?.trim()
      const n = c.name?.trim() || r || 'coverage'
      return r ? `${n} [${r}]` : n
    })

  // Forms — dedupe by normalised key, emit the spaced display form (so the citation verifier's
  // form-number matcher recognises it), sort by display.
  const formSeen = new Set<string>()
  const forms = p.formNumbers
    .map(formDisplay)
    .filter(f => { const k = formKey(f); if (!f || formSeen.has(k)) return false; formSeen.add(k); return true })
    .sort(cmp)
    .map(f => `[${f}]`)

  // Rule refIds — drop blanks, dedupe, sort.
  const ruleSeen = new Set<string>()
  const rules = (p.ruleRefIds ?? [])
    .map(r => r?.trim())
    .filter((r): r is string => !!r && (ruleSeen.has(r) ? false : (ruleSeen.add(r), true)))
    .sort(cmp)
    .map(r => `[${r}]`)

  // Rating — one headline per program, deduped by programRef, sorted.
  const rateSeen = new Set<string>()
  const rating = (p.rating ?? [])
    .filter(r => { const k = r.programRef?.trim(); if (!k || rateSeen.has(k)) return false; rateSeen.add(k); return true })
    .sort((a, b) => cmp(a.programRef, b.programRef))
    .map(r => `[${r.programRef.trim()}] worked example → $${Math.round(r.premium).toLocaleString('en-US')}`)

  const lines = [
    head,
    listLine('Coverages', coverages, MAX_COVERAGES),
    listLine('Forms', forms, MAX_FORMS),
    listLine('Rules', rules, MAX_RULES),
    rating.length ? `  Rating: ${rating.join('; ')}` : '',
  ].filter(Boolean)
  return lines.join('\n')
}

/**
 * Assemble the portfolio digest string from live catalogue data.
 *
 * Guarantees (all covered by shared/src/grounding/portfolioDigest.test.ts):
 *  - Deterministic + stable-ordered: identical output for the same input regardless of the
 *    order products / coverages / forms / rules arrive in.
 *  - Budget-bounded: estimateDigestTokens(result) ≤ tokenBudget. Lower-priority product
 *    sections are dropped (with an honest "N more products" note) before the budget is exceeded.
 *  - Grounded: every emitted [refId] / [form number] is present in the input — nothing is minted.
 *  - Returns '' for an empty portfolio (the caller then injects no digest block).
 */
export function assemblePortfolioDigest(
  input: PortfolioDigestInput,
  opts: PortfolioDigestOptions = {},
): string {
  const products = input?.products ?? []
  if (products.length === 0) return ''

  const budget = Math.max(1, Math.floor(opts.tokenBudget ?? DIGEST_TOKEN_BUDGET))

  // Canonical product order: by refId, then name — so shuffled inputs produce identical output.
  const sections = [...products]
    .sort((a, b) => cmp(a.refId?.trim() ?? '', b.refId?.trim() ?? '') || cmp(a.name ?? '', b.name ?? ''))
    .map(renderProduct)

  // Fill under the budget. Summing per-part token estimates is an upper bound on the whole
  // (ceil is subadditive), and NOTE_RESERVE keeps room for the truncation note, so the final
  // string is guaranteed ≤ budget. SEP accounts for the "\n\n" join between parts.
  const SEP = 1
  const NOTE_RESERVE = 24
  const parts: string[] = [PREAMBLE]
  let used = estimateDigestTokens(PREAMBLE)
  let shown = 0
  for (const section of sections) {
    const cost = estimateDigestTokens(section) + SEP
    if (used + cost + NOTE_RESERVE > budget) break
    parts.push(section)
    used += cost
    shown++
  }

  const dropped = sections.length - shown
  if (dropped > 0) {
    parts.push(`… plus ${dropped} more product${dropped === 1 ? '' : 's'} not shown here — ask and the tools will retrieve them.`)
  }

  return parts.join('\n\n')
}
