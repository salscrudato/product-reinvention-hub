// retrieval/types.ts — the platform-free contract for grounded retrieval.
// A GroundingChunk is one semantically-coherent slice of the corpus (a coverage,
// a rule, a form, a dictionary term, a rating program, or a paragraph of base-form
// text) carried together with the traceability metadata the AI must cite: its
// refId and/or form number. Both the offline lexical ranker (shared) and the online
// dense retriever (functions/, Voyage + a vector store) speak in these chunks, so the
// tool surface returns the SAME shape regardless of which backend produced it.
//
// Pure TypeScript (zero platform imports): the chunk builders + lexical retrieval run
// in the offline gate/eval, and functions/ reuses them behind the Voyage seam.

/** The kind of corpus entity a chunk was derived from. Mirrors SearchEntityType plus
 *  the derived sources (rating programs, base-form prose) that retrieval also indexes. */
export type ChunkSourceType =
  | 'product' | 'coverage' | 'rule' | 'formRule' | 'form' | 'dictionary'
  | 'ldTable' | 'rtTable' | 'ratingProgram' | 'baseForm'

/** The traceability envelope for a chunk. `refId` / `formNumber` are the load-bearing
 *  citation anchors — they are verified against the live catalogue before any cited
 *  answer is shown, so a chunk NEVER carries a fabricated id. */
export interface ChunkMetadata {
  type:        ChunkSourceType
  refId:       string | null   // domain refId (e.g. PH.COV.001) when the source has one
  formNumber:  string | null   // ISO form number (e.g. HO 00 03) when the source is/attaches one
  productId:   string | null   // owning product refId (e.g. PH.PROD.001), null for globals
  path:        string          // Firestore path (or logical path) — routes the citation to a screen
  title:       string          // short human label for the UI status chip / citation title
  section?:    string          // sub-section label when one source yields multiple chunks
}

/** One retrievable unit. `id` is deterministic + stable across rebuilds so the vector
 *  store can upsert incrementally; `contentHash` lets the indexer skip unchanged chunks. */
export interface GroundingChunk {
  id:          string
  text:        string          // the body that is embedded / lexically ranked
  contentHash: string
  metadata:    ChunkMetadata
}

/** A retrieved chunk with its relevance score (0..1, higher = better). */
export interface RetrievalHit {
  chunk: GroundingChunk
  score: number
}
