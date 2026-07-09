// rank.ts — dependency-free vector-space retrieval for grounding. Documents and
// the query are turned into sparse TF-IDF vectors and scored by cosine
// similarity, so the AI's search tool retrieves the *most relevant* entities
// rather than any that merely contain a token. Pure and deterministic (tested).
// AWS-SWAP: to move to dense embeddings, swap this ranker for a call to an
// embeddings service (e.g. Bedrock Titan / Voyage) + a vector store; the
// { id, score } contract stays the same so callers don't change.

export interface RankDoc { id: string; text: string }
export interface Ranked { id: string; score: number }

const tokenize = (s: string): string[] =>
  s.toLowerCase().split(/[^a-z0-9.]+/).filter(t => t.length > 1)

/**
 * Rank documents by TF-IDF cosine similarity to the query.
 * Returns ids sorted by descending score (0..1). With an empty query, returns
 * the documents in their original order at score 0.
 */
export function rankDocuments(query: string, docs: RankDoc[], topK = 15): Ranked[] {
  const qTokens = tokenize(query)
  if (qTokens.length === 0) return docs.slice(0, topK).map(d => ({ id: d.id, score: 0 }))

  const N = docs.length || 1
  const docTokens = docs.map(d => tokenize(d.text))

  // Document frequency for idf.
  const df = new Map<string, number>()
  for (const toks of docTokens) for (const w of new Set(toks)) df.set(w, (df.get(w) ?? 0) + 1)
  const idf = (w: string) => Math.log(1 + N / ((df.get(w) ?? 0) + 1))

  // Query vector.
  const qtf = new Map<string, number>()
  for (const w of qTokens) qtf.set(w, (qtf.get(w) ?? 0) + 1)
  const qVec = new Map<string, number>()
  qtf.forEach((tf, w) => qVec.set(w, tf * idf(w)))
  const qNorm = Math.sqrt([...qVec.values()].reduce((s, v) => s + v * v, 0)) || 1

  const scored: Ranked[] = docs.map((d, i) => {
    const tf = new Map<string, number>()
    for (const w of docTokens[i]!) tf.set(w, (tf.get(w) ?? 0) + 1)
    let dot = 0, sumSq = 0
    tf.forEach((f, w) => {
      const wt = f * idf(w)
      sumSq += wt * wt
      const qw = qVec.get(w)
      if (qw) dot += qw * wt
    })
    const dNorm = Math.sqrt(sumSq) || 1
    return { id: d.id, score: dot / (qNorm * dNorm) }
  })

  return scored.sort((a, b) => b.score - a.score).slice(0, topK)
}
