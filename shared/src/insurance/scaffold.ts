// scaffold.ts — the grounded "scaffold a new product" contract + its anti-fabrication
// guard. A product manager describes the product they want; Claude reads the REAL
// portfolio via the grounding tools and proposes a starting structure — a product
// shell plus coverages and rules — modelled on what already exists. This module owns
// the wire shapes both sides agree on AND the pure sanitizer that keeps the model
// honest:
//
//   • Every proposal MUST carry a non-empty citation (the existing product / coverage
//     / form it was modelled on) — anything without one is dropped here, in code.
//   • Coverages, forms and rules are shaped by the SAME extraction sanitizers the
//     base-form flow uses, so the "cite or be dropped" rule is enforced identically.
//     (`text` is null: grounding isn't a document grep — the server additionally
//     verifies every cited form number / coverage refId against Firestore before the
//     draft is written, exactly like the rule composer.)
//   • The model never emits refIds; those are allocated by the app at persist time,
//     so a fabricated coverage/rule refId is structurally impossible.
//
// Pure TypeScript (zero platform imports) so functions/ imports it AND the gate test
// exercises the guard deterministically without a live model. See
// functions/src/scaffoldProduct.ts.
import {
  cleanCoverages, cleanForms, cleanRules,
  type ProposedCoverage, type ProposedForm, type ProposedRule, type ExtractionSection,
} from './extraction'

// ─── Wire shapes (client + server agree on these) ───────────────────────────────

/** The proposed product shell — everything needed to create the DRAFT product doc,
 *  minus the refId (allocated by the app) and governance (stamped by mutate()). */
export interface ProposedProductShell {
  name:          string
  lobPrefix:     string   // 'HO' | 'GL' | … — resolved to a real registered LOB server-side
  marketSegment: string
  description:   string
  citation:      string   // the existing product(s) this scaffold leverages
}

/** The full scaffold the composer renders for review. `product` is null when the
 *  model couldn't ground a coherent shell (e.g. no matching line in the portfolio). */
export interface ScaffoldPlan {
  product:   ProposedProductShell | null
  coverages: ExtractionSection<ProposedCoverage>
  forms:     ExtractionSection<ProposedForm>
  rules:     ExtractionSection<ProposedRule>
  warnings:  string[]
}

// ─── Coercion helpers ───────────────────────────────────────────────────────────

const str = (v: unknown): string => String(v ?? '').trim()

/** Shape the product shell from raw model tool input. Returns null (and pushes a
 *  warning) when the model gave no name or — crucially — no citation, so an
 *  ungrounded product can never reach the review card. LOB validity (the prefix must
 *  resolve to a registered line) is verified server-side against the registry. */
export function cleanScaffoldProductShell(
  input: Record<string, unknown> | undefined,
  warnings: string[],
): ProposedProductShell | null {
  const raw = (input?.product ?? {}) as Record<string, unknown>
  const name = str(raw.name)
  const citation = str(raw.citation)
  if (!name) { warnings.push('No product name proposed — nothing to scaffold.'); return null }
  if (!citation) { warnings.push('Product proposal dropped: it cited no existing product to model on.'); return null }
  return {
    name,
    lobPrefix:     str(raw.lobPrefix).toUpperCase(),
    marketSegment: str(raw.marketSegment),
    description:   str(raw.description),
    citation,
  }
}

/** Turn one raw `emit_product_scaffold` tool input into a review-ready ScaffoldPlan.
 *  Pure and deterministic: the citation guarantee is enforced here; Firestore-level
 *  verification of the cited references is layered on top by the server. */
export function cleanScaffold(input: Record<string, unknown> | undefined): ScaffoldPlan {
  const warnings: string[] = []
  const product = cleanScaffoldProductShell(input, warnings)
  // text = null: grounding is not a document grep here — it's DB verification done by
  // the server. The extraction cleaners still enforce the mandatory citation.
  return {
    product,
    coverages: cleanCoverages(input, null),
    forms:     cleanForms(input, null),
    rules:     cleanRules(input, null),
    warnings,
  }
}
