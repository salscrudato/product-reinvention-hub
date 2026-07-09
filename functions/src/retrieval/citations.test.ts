// citations.test.ts — the Citations-API bridge is exercised offline: building citeable
// documents from chunks, and resolving returned citations back to verifiable anchors. This
// is the server-verifiable-grounding guarantee (C1) tested without a live model call.
import { describe, it, expect } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import type { RetrievalHit, GroundingChunk } from '@pf/shared'
import { buildCiteableDocuments, verifyCitations, citationsFromConvo } from './citations'

const chunk = (id: string, refId: string | null, formNumber: string | null, text: string): GroundingChunk => ({
  id, text, contentHash: 'deadbeef',
  metadata: { type: refId ? 'coverage' : 'form', refId, formNumber, productId: 'PH.PROD.001', path: `x/${id}`, title: id },
})
const hit = (c: GroundingChunk): RetrievalHit => ({ chunk: c, score: 0.9 })

const contentBlockCite = (document_index: number, cited_text = 'the cited span'): Anthropic.TextCitation => ({
  type: 'content_block_location', cited_text, document_index, document_title: null,
  start_block_index: 0, end_block_index: 1,
})

describe('buildCiteableDocuments', () => {
  it('emits one citeable document per chunk with the refId/form anchor as title', () => {
    const { blocks, index } = buildCiteableDocuments([
      hit(chunk('coverage:PH.COV.001', 'PH.COV.001', null, 'Coverage A dwelling')),
      hit(chunk('form:HO0003', null, 'HO 00 03', 'Homeowners special form')),
    ])
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.type).toBe('document')
    expect(blocks[0]!.citations).toEqual({ enabled: true })
    expect(blocks[0]!.title).toBe('PH.COV.001')
    expect(blocks[1]!.title).toBe('HO 00 03')
    // index is parallel to blocks (document_index → metadata)
    expect(index[0]!.refId).toBe('PH.COV.001')
    expect(index[1]!.formNumber).toBe('HO 00 03')
  })
})

describe('verifyCitations', () => {
  const index = buildCiteableDocuments([
    hit(chunk('coverage:PH.COV.001', 'PH.COV.001', null, 'A')),
    hit(chunk('form:HO0003', null, 'HO 00 03', 'B')),
  ]).index

  it('resolves valid citations to their chunk anchors', () => {
    const v = verifyCitations([contentBlockCite(0), contentBlockCite(1)], index)
    expect(v.anchors.sort()).toEqual(['HO 00 03', 'PH.COV.001'])
    expect(v.invalid).toBe(0)
    expect(v.citedText.length).toBe(2)
  })

  it('flags a citation whose document_index is outside the supplied set', () => {
    const v = verifyCitations([contentBlockCite(5)], index)
    expect(v.invalid).toBe(1)
    expect(v.anchors).toEqual([])
  })

  it('ignores a web-search citation (no document_index into the chunk set)', () => {
    const webCite = {
      type: 'web_search_result_location', cited_text: 'x', url: 'https://e.test',
      title: 't', encrypted_index: 'z',
    } as unknown as Anthropic.TextCitation
    const v = verifyCitations([webCite], index)
    expect(v.invalid).toBe(1)   // no document_index → not resolvable to a chunk
  })
})

describe('citationsFromConvo', () => {
  it('collects citations from assistant text blocks across turns', () => {
    const convo: Anthropic.MessageParam[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [
        { type: 'text', text: 'answer', citations: [contentBlockCite(0)] } as unknown as Anthropic.ContentBlockParam,
      ] },
    ]
    const cites = citationsFromConvo(convo)
    expect(cites).toHaveLength(1)
    expect((cites[0] as Anthropic.CitationContentBlockLocation).document_index).toBe(0)
  })
})
