'use strict'
const crypto = require('crypto')

async function exportDuckCreek(req, res) {
  const { productId, productRefId, manuScriptID } = req.body ?? {}
  if (typeof productId !== 'string' || !productId)
    return res.status(400).json({ error: 'productId is required' })
  if (typeof manuScriptID !== 'string' || !manuScriptID)
    return res.status(400).json({ error: 'manuScriptID is required' })
  const { docs } = require('../cosmos')
  const tid   = req.tenant
  const actor = { uid: req.user?.uid ?? 'unknown', name: req.user?.name ?? req.user?.email ?? 'User' }
  await docs.items.create({
    id:       crypto.randomUUID(),
    pk:       `${tid}|__duckcreek_audit__`,
    kind:     'duckcreek_export_audit',
    tenantId: tid,
    data: {
      actor,
      action:     'export-duckcreek',
      entityType: 'product',
      entityPath: `products/${productId}`,
      productId,
      ...(typeof productRefId === 'string' && productRefId ? { productRefId } : {}),
      manuScriptID,
      at: new Date().toISOString(),
    },
  })
  return res.json({ ok: true })
}

module.exports = { exportDuckCreek }
