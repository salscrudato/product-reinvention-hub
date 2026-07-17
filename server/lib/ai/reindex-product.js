'use strict'
const { requireTenant } = require('../auth')
const { requireCapability } = require('../authz')
const embed = require('../embed')
const { _getChunker } = require('./_shared')

function registerReindexRoute(router) {
  router.post('/reindexProduct', requireCapability('product:write'), requireTenant, async (req, res) => {
    const { productId } = req.body || {}
    if (typeof productId !== 'string' || !productId)
      return res.status(400).json({ error: 'productId_required' })
    const tid = req.user.tenantId
    const { docs } = require('../cosmos').resolveTenantStore(tid)   // SILO_READY seam
    const ch = _getChunker()
    const now = new Date().toISOString()
    const segs = (p) => String(p || '').split('/').filter(Boolean)
    const idFor = (prefix, key) => `${prefix}:${String(key).replace(/[/\\?#]/g, '~')}`
    const pkFor = (path) => { const s = segs(path); return `${tid}|${s[0] === 'products' && s[1] ? s[1] : s[0] || 'root'}` }

    async function listColl(coll, limit = 200) {
      const sql = `SELECT TOP ${limit} c.data, c.path, c.entityType FROM c WHERE c.kind='entity' AND c.coll=@coll AND c.tenantId=@tid`
      const { resources } = await docs.items.query({ query: sql, parameters: [{ name: '@coll', value: coll }, { name: '@tid', value: tid }] }, { maxItemCount: limit }).fetchAll()
      return resources
    }

    // Build a grounding chunk (WITHOUT embedding) for one entity, or null if not chunkable.
    // Embedding is deferred so every chunk in the product is embedded in ONE batched call.
    function buildChunk(entityType, entityPath, data) {
      const s = segs(entityPath)
      const pid = s[0] === 'products' && s[1] ? s[1] : null
      const refId = data.refId || s.at(-1) || ''
      let chunk = null
      if (entityType === 'product')       chunk = ch.chunkProduct?.(data)
      else if (entityType === 'coverage' && pid) chunk = ch.chunkCoverage?.(data, pid)
      else if (entityType === 'rule' && pid)     chunk = ch.chunkRule?.(data, pid)
      else if (entityType === 'formRule' && pid) chunk = ch.chunkFormRule?.(data, pid)
      else if (entityType === 'ratingProgram' && pid) chunk = ch.chunkRatingProgram?.(data, pid)
      else if (entityType === 'ldTable')  chunk = ch.chunkLdTable?.(refId, data)
      else if (entityType === 'rtTable')  chunk = ch.chunkRtTable?.(refId, data)
      else if (entityType === 'form')     chunk = ch.chunkForm?.(data)
      if (!chunk?.id || !chunk?.text) return null
      const chunkDoc = { id: chunk.id, text: chunk.text, contentHash: chunk.contentHash, metadata: chunk.metadata, type: entityType, productId: pid, updatedAt: now }
      return { id: idFor('chunk', entityPath), pk: pkFor(entityPath), entityPath, entityType, chunkDoc, text: chunk.text }
    }

    async function persistChunk(c, embedding) {
      try {
        const chunkDoc = { ...c.chunkDoc }
        if (embedding) { chunkDoc.embedding = embedding; chunkDoc.embDims = embed.EMBED_DIMS }
        await docs.items.upsert({
          id: c.id, pk: c.pk, tenantId: tid,
          kind: 'entity', coll: 'groundingChunks',
          entityPath: c.entityPath, entityType: c.entityType,
          data: chunkDoc,
          updatedAt: now,
        })
        return true
      } catch { return false }
    }

    try {
      const productPath = `products/${productId}`
      let productEnt = null
      try { const r = (await docs.item(idFor('ent', productPath), pkFor(productPath)).read()).resource; productEnt = r && r.tenantId === tid ? r : null } catch { /* not found */ }
      if (!productEnt) return res.status(404).json({ error: 'product_not_found', productId })

      const [coverages, rules, formRules, ratingPrograms] = await Promise.all([
        listColl(`products/${productId}/coverages`),
        listColl(`products/${productId}/rules`),
        listColl(`products/${productId}/formRules`),
        listColl(`products/${productId}/ratingPrograms`),
      ])

      // Build all chunks first, then embed them in ONE batched call (embedBatch sub-batches +
      // retries internally) instead of an embed round-trip per chunk (was N+1). Embedding is
      // best-effort: null vectors → persist the chunk anyway for lexical-only ranking.
      const chunks = []
      const pc = buildChunk('product', productPath, productEnt.data)
      if (pc) chunks.push(pc)
      for (const e of [...coverages, ...rules, ...formRules, ...ratingPrograms]) {
        const c = buildChunk(e.entityType, e.path, e.data)
        if (c) chunks.push(c)
      }

      let vectors = null
      try { vectors = await embed.embedBatch(chunks.map((c) => c.text)) } catch { vectors = null }

      // Upsert with bounded concurrency so a large product doesn't stampede Cosmos.
      let indexed = 0
      const CONC = 12
      for (let i = 0; i < chunks.length; i += CONC) {
        const rs = await Promise.all(chunks.slice(i, i + CONC).map((c, j) => {
          const v = vectors && vectors[i + j] ? embed.quantize(vectors[i + j]) : null
          return persistChunk(c, v)
        }))
        indexed += rs.filter(Boolean).length
      }
      res.json({ ok: true, productId, indexed })
    } catch (err) {
      res.status(500).json({ error: 'reindex_failed', detail: String((err && err.message) || err).slice(0, 220) })
    }
  })
}

module.exports = { registerReindexRoute }
