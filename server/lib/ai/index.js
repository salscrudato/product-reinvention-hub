'use strict'
const express = require('express')
const { requireRole, requireTenant } = require('../auth')
const { requireCapability } = require('../authz')
const fleet = require('../fleet')

const { chat }            = require('./chat')
const { summarizeProduct } = require('./summarize-product')
const { scaffoldProduct }  = require('./scaffold-product')
const { draftRule }        = require('./draft-rule')
const { analyzeClaim }     = require('./analyze-claim')
const { unifiedImport }    = require('./unified-import')
const { registerReindexRoute } = require('./reindex-product')
const { identifyBaseForm } = require('./identify-base-form')
const { proposeMapping }   = require('./propose-mapping')
const { shapeFeedback }    = require('./shape-feedback')
const { refreshNews }      = require('./refresh-news')

console.log(`[prodhub-host] AI configured=${fleet.isConfigured()}`)

const router = express.Router()

registerReindexRoute(router)

router.post('/:name', requireCapability('ai:invoke'), requireTenant, async (req, res) => {
  const name = req.params.name
  // identifyBaseForm has its own AI-not-configured fallback (regex extraction still works).
  if (name === 'identifyBaseForm') return identifyBaseForm(req, res)
  if (!fleet.isConfigured()) return res.status(503).json({ error: 'ai_not_configured', name })
  if (name === 'chat')            return chat(req, res)
  if (name === 'summarizeProduct') return summarizeProduct(req, res)
  if (name === 'unifiedImport')    return unifiedImport(req, res)
  if (name === 'scaffoldProduct')  return scaffoldProduct(req, res)
  if (name === 'draftRule')        return draftRule(req, res)
  if (name === 'analyzeClaim')     return analyzeClaim(req, res)
  if (name === 'proposeMapping')   return proposeMapping(req, res)
  if (name === 'shapeFeedback')    return shapeFeedback(req, res)
  if (name === 'refreshNews')      return refreshNews(req, res)
  return res.status(501).json({ error: 'ai_handler_not_ported', name })
})

module.exports = router
