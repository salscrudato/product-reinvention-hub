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

    async function upsertChunk(entityType, entityPath, data) {
      try {
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
        if (!chunk?.id || !chunk?.text) return false
        const pk = pkFor(entityPath)
        let embedding = null
        try { const v = await embed.embedOne(chunk.text); if (v) embedding = embed.quantize(v) } catch { /* lexical fallback */ }
        const chunkDoc = { id: chunk.id, text: chunk.text, contentHash: chunk.contentHash, metadata: chunk.metadata, type: entityType, productId: pid, updatedAt: now }
        if (embedding) { chunkDoc.embedding = embedding; chunkDoc.embDims = embed.EMBED_DIMS }
        await docs.items.upsert({
          id: idFor('chunk', entityPath), pk, tenantId: tid,
          kind: 'entity', coll: 'groundingChunks',
          entityPath, entityType,
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

      let indexed = 0
      if (await upsertChunk('product', productPath, productEnt.data)) indexed++

      const [coverages, rules, formRules, ratingPrograms] = await Promise.all([
        listColl(`products/${productId}/coverages`),
        listColl(`products/${productId}/rules`),
        listColl(`products/${productId}/formRules`),
        listColl(`products/${productId}/ratingPrograms`),
      ])
      for (const e of [...coverages, ...rules, ...formRules, ...ratingPrograms]) {
        if (await upsertChunk(e.entityType, e.path, e.data)) indexed++
      }
      res.json({ ok: true, productId, indexed })
    } catch (err) {
      res.status(500).json({ error: 'reindex_failed', detail: String((err && err.message) || err).slice(0, 220) })
    }
  })
}

module.exports = { registerReindexRoute }
