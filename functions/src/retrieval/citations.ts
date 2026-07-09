// retrieval/citations.ts — bridge retrieved chunks to Anthropic's Citations API.
//
// Passing retrieved chunks as `document` content blocks with citations.enabled lets the
// model cite chunk-level spans (cited_text), and — critically — makes grounding
// SERVER-VERIFIABLE: each returned citation carries a document_index back into the chunk
// set we supplied, so we can confirm the model cited a REAL chunk and resolve its
// refId / form number. cited_text does NOT count as output tokens, and citations must not
// be combined with structured outputs — so we keep them on the PROSE channel; a feature's
// structured `emit_*` tool (claims determination, rule/scaffold drafts) stays separate.
import type Anthropic from '@anthropic-ai/sdk'
import type { RetrievalHit, ChunkMetadata } from '@pf/shared'

/** Build citeable `document` blocks from retrieved chunks. The parallel `index` maps each
 *  block's position (document_index) → its chunk metadata, so a returned citation resolves
 *  to a verifiable refId / form number. The document title carries the anchor for the UI. */
export function buildCiteableDocuments(hits: RetrievalHit[]): {
  blocks: Anthropic.DocumentBlockParam[]
  index:  ChunkMetadata[]
} {
  const blocks: Anthropic.DocumentBlockParam[] = []
  const index:  ChunkMetadata[] = []
  for (const h of hits) {
    const m = h.chunk.metadata
    blocks.push({
      type:      'document',
      source:    { type: 'content', content: [{ type: 'text', text: h.chunk.text }] },
      title:     m.refId ?? m.formNumber ?? m.title,
      context:   JSON.stringify({ type: m.type, refId: m.refId, formNumber: m.formNumber, path: m.path }),
      citations: { enabled: true },
    })
    index.push(m)
  }
  return { blocks, index }
}

/** Collect every citation the assistant emitted across all its text blocks in a completed
 *  conversation. Reads the citations off the runtime response objects (MessageParam widens
 *  them away at the type level, so a narrow cast recovers them). */
export function citationsFromConvo(convo: Anthropic.MessageParam[]): Anthropic.TextCitation[] {
  const out: Anthropic.TextCitation[] = []
  for (const m of convo) {
    if (m.role !== 'assistant' || typeof m.content === 'string') continue
    for (const b of m.content) {
      if (b.type !== 'text') continue
      const cites = (b as { citations?: Anthropic.TextCitation[] | null }).citations
      if (cites) out.push(...cites)
    }
  }
  return out
}

export interface VerifiedCitations {
  anchors:   string[]   // refIds + form numbers actually cited, resolved from chunk metadata
  citedText: string[]   // the cited spans (evidence the answer leaned on)
  invalid:   number     // citations whose document_index fell outside the supplied chunk set
}

/**
 * Resolve returned citations back to the chunks we supplied. Every valid citation points
 * at a real chunk (by construction of `index`), so `anchors` is the set of server-verified
 * refIds/form numbers the answer cited. `invalid` counts any citation whose document_index
 * is out of range — an anomaly worth surfacing (should be zero in normal operation).
 */
export function verifyCitations(
  citations: readonly Anthropic.TextCitation[],
  index: readonly ChunkMetadata[],
): VerifiedCitations {
  const anchors = new Set<string>()
  const citedText: string[] = []
  let invalid = 0
  for (const c of citations) {
    // Only document-backed citations carry a document_index into our set (a web-search
    // location does not); guard on the field's presence.
    const di = 'document_index' in c && typeof c.document_index === 'number' ? c.document_index : -1
    const meta = di >= 0 && di < index.length ? index[di] : undefined
    if (!meta) { invalid++; continue }
    if (meta.refId) anchors.add(meta.refId)
    if (meta.formNumber) anchors.add(meta.formNumber)
    if ('cited_text' in c && c.cited_text) citedText.push(c.cited_text)
  }
  return { anchors: [...anchors], citedText, invalid }
}
