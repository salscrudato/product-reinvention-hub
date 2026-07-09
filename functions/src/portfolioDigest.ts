// portfolioDigest.ts — the SERVER side of the chat portfolio digest: read the live catalogue,
// compute each product's worked-example premium, hand the shaped data to the pure assembler
// (@pf/shared), and cache the resulting string in-memory with a short TTL. The chat endpoint
// injects the cached string into its STABLE system prefix (inside the ephemeral-cache
// breakpoint) so digest-covered questions answer without a tool round-trip while still citing
// [refId]/[form]. Deep questions still hit the tools — the digest is an index, not the record.
//
// Grounding note: this only reshapes data the grounding tools already read; the assembler emits
// nothing that isn't in this input, and the non-invention + cite-everything rules travel in the
// digest preamble. Best-effort: any failure yields the stale or empty digest, never an error to
// the caller — chat then falls back to pure tool grounding.
import { getFirestore } from 'firebase-admin/firestore'
import {
  assemblePortfolioDigest, evaluate, resolveRatingKit, resolveLobByRefId, DEFAULT_LOB,
} from '@pf/shared'
import type {
  PortfolioDigestInput, PortfolioDigestProduct,
  Product, Coverage, Rule, Form, RatingProgram, RTTable, LDTable, RatingInputMap,
} from '@pf/shared'

/** Read the live catalogue and shape it for the pure assembler. Full-collection reads are cheap
 *  at seed scale and run at most once per TTL per instance (far cheaper than the per-request
 *  citation-catalogue load). Per-product failures degrade gracefully — a product still lists
 *  whatever resolved. */
async function buildDigestInput(): Promise<PortfolioDigestInput> {
  const db = getFirestore()

  // Rate tables are global; read once and reuse across every program's worked example.
  const [prodSnap, rtSnap, ldSnap] = await Promise.all([
    db.collection('products').get(),
    db.collection('rtTables').get(),
    db.collection('ldTables').get(),
  ])
  const rtTables: Record<string, RTTable> = {}
  for (const d of rtSnap.docs) rtTables[d.id] = d.data() as RTTable
  const ldTables: Record<string, LDTable> = {}
  for (const d of ldSnap.docs) ldTables[d.id] = d.data() as LDTable

  const products = await Promise.all(prodSnap.docs.map(async (doc): Promise<PortfolioDigestProduct> => {
    const id = doc.id
    const p  = doc.data() as Product

    const [covSnap, ruleSnap, rpSnap, formSnap] = await Promise.all([
      db.collection(`products/${id}/coverages`).get(),
      db.collection(`products/${id}/rules`).get(),
      db.collection(`products/${id}/ratingPrograms`).get(),
      db.collection('forms').where('productRefIds', 'array-contains', id).get().catch(() => null),
    ])

    const coverages = covSnap.docs.map(d => {
      const c = d.data() as Coverage
      return { refId: c.refId, name: c.name }
    })
    const ruleRefIds  = ruleSnap.docs.map(d => (d.data() as Rule).refId)
    const formNumbers = (formSnap?.docs ?? []).map(d => (d.data() as Form).number).filter(Boolean)

    // Worked-example premium per program — the same path run_rating uses (resolve the line's kit
    // from the program refId, evaluate its worked example). Per-program try/catch so one malformed
    // program can't drop the whole product's rating line.
    const rating: { programRef: string; premium: number }[] = []
    for (const d of rpSnap.docs) {
      const program = d.data() as RatingProgram
      const ref = program.refId
      if (!ref) continue
      try {
        const kit    = resolveRatingKit((resolveLobByRefId(ref) ?? DEFAULT_LOB).prefix)
        const inputs = { ...kit.workedExample } as RatingInputMap
        const { finalPremium } = evaluate(program, inputs, kit.makeRtGetter(rtTables), kit.makeLdGetter(ldTables))
        if (Number.isFinite(finalPremium)) rating.push({ programRef: ref, premium: finalPremium })
      } catch { /* skip an un-evaluable program; the tools can still price it on demand */ }
    }

    return { refId: p.refId, name: p.name, lob: p.lob?.name ?? null, coverages, formNumbers, ruleRefIds, rating }
  }))

  return { products }
}

// ─── In-memory cache (short TTL, per-instance) ───────────────────────────────────
// Deterministic + stable assembler output means the cached string is byte-identical across the
// TTL, so the chat system prefix stays cache-warm between requests; it only changes when the
// catalogue does (next rebuild). Built lazily on the first request after a cold start, then
// reused; concurrent rebuilds are coalesced onto one in-flight promise.
const TTL_MS = 5 * 60_000
let cached: { text: string; builtAt: number } | null = null
let inflight: Promise<string> | null = null

/** The cached portfolio digest string (possibly ''). Never throws — a build failure serves the
 *  last good digest, or '' if none was ever built, and chat degrades to pure tool grounding. */
export async function getPortfolioDigest(): Promise<string> {
  if (cached && Date.now() - cached.builtAt < TTL_MS) return cached.text
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const text = assemblePortfolioDigest(await buildDigestInput())
      cached = { text, builtAt: Date.now() }
      return text
    } catch (e) {
      console.warn('[digest] build failed; serving stale/empty:', e)
      return cached?.text ?? ''
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** Drop the cache so the next getPortfolioDigest() rebuilds (used by tests). */
export function resetPortfolioDigestCache(): void {
  cached = null
  inflight = null
}
