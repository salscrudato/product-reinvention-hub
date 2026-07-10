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
//
// Cache alignment (G): The Anthropic prompt cache holds the STABLE system prefix for 1 hour.
// If the digest rebuilds every 5 minutes and produces a semantically-identical string, any
// byte-level difference invalidates the cached prefix and doubles input tokens for the next
// several requests. The fix: rebuild on the short TTL but ONLY replace the served string when
// its SHA-256 content hash changes. Concurrent instances that see the same epoch skip the swap,
// so an unchanged catalogue costs only one cheap Firestore read per chat turn. Mutations
// propagate promptly because invalidate.ts bumps meta/digestEpoch on every entity write —
// the next getPortfolioDigest() call sees the new epoch and rebuilds immediately even within
// the TTL.
//
// Scale note: at 50+ products, the full-collection buildDigestInput() read becomes expensive.
// Move the build to a scheduled Cloud Function (every 10 minutes) that writes the digest to
// Firestore, and have getPortfolioDigest() read that stored doc instead. Do not build this now.
import { createHash } from 'node:crypto'
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

// ─── In-memory cache (short TTL + content-hash swap + epoch-aware, per-instance) ─────────────
// The cache is rebuilt when EITHER the TTL expires OR the mutation epoch has advanced since the
// last build. On rebuild, the assembled text's SHA-256 prefix (16 hex chars) is compared to the
// last cached hash; the SERVED string is only swapped if the content actually changed. This
// keeps the Anthropic stable-prefix prompt-cache warm for the full 1-hour window even as the
// 5-minute TTL keeps firing on unchanged catalogue data — no doubled input-token cost.

const TTL_MS = 5 * 60_000

interface DigestCache {
  text:    string   // the string currently served to chat
  hash:    string   // SHA-256 prefix of text (first 16 hex chars) — change detector
  builtAt: number   // ms since epoch at last successful build
  epoch:   number   // meta/digestEpoch.v at last build — detects mutations within TTL
}
let cached:   DigestCache | null = null
let inflight: Promise<string>  | null = null

/** Read the mutation epoch from Firestore (cheap single-doc get). Falls back to 0 on error. */
async function readDigestEpoch(): Promise<number> {
  try {
    const snap = await getFirestore().doc('meta/digestEpoch').get()
    return (snap.data() as { v?: number } | undefined)?.v ?? 0
  } catch { return 0 }
}

/** SHA-256 content fingerprint — first 16 hex chars (64-bit collision resistance is ample). */
function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

/** The cached portfolio digest string (possibly ''). Never throws — a build failure serves the
 *  last good digest (or '' if none was ever built) and chat degrades to pure tool grounding. */
export async function getPortfolioDigest(): Promise<string> {
  const epoch = await readDigestEpoch()
  const stale = !cached
    || Date.now() - cached.builtAt >= TTL_MS
    || epoch !== cached.epoch      // a mutation bumped the epoch — rebuild immediately

  if (!stale) return cached!.text
  if (inflight) return inflight

  inflight = (async () => {
    try {
      const newText = assemblePortfolioDigest(await buildDigestInput())
      const newHash = hashText(newText)
      // Content-hash swap: only replace the served string when the catalogue actually changed.
      // Serving an identical string keeps the Anthropic prompt-cache warm for the full 1-hour
      // window; replacing it resets the clock and costs input tokens for the next ~5 requests.
      const text = (cached && newHash === cached.hash) ? cached.text : newText
      cached = { text, hash: newHash, builtAt: Date.now(), epoch }
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

/** Drop the cache so the next getPortfolioDigest() rebuilds (used by tests and the
 *  on-demand flush endpoint). Resets epoch so any live epoch will look "new". */
export function resetPortfolioDigestCache(): void {
  cached = null
  inflight = null
}
