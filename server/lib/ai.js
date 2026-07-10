'use strict'
// ai.js — /api/ai/* : AI on the Azure host, backed by Azure AI Foundry (Claude).
//
// Replaces the Firebase Cloud Functions AI surface. Every callable/stream name
// the app uses (chat, analyzeClaim, extractCoverages, draftRule, describeForm,
// interpretSearch, summarizeProduct, …) routes through here. Auth is enforced
// server-side (mirrors the old authenticate() guard).
//
// The Foundry client is wired from App Service settings:
//   AZURE_FOUNDRY_ENDPOINT, AZURE_FOUNDRY_KEY, AZURE_FOUNDRY_DEPLOYMENT (=claude-opus-4-8)
// Until those are set this returns an HONEST 503 (never a faked answer). Once
// set + the per-name handlers are ported, the same routes serve real responses.

const express = require('express')
const { requireAuth } = require('./auth')

const router = express.Router()
const ENDPOINT = process.env.AZURE_FOUNDRY_ENDPOINT
const KEY = process.env.AZURE_FOUNDRY_KEY
const DEPLOYMENT = process.env.AZURE_FOUNDRY_DEPLOYMENT || 'claude-opus-4-8'
const configured = Boolean(ENDPOINT && KEY)

console.log(`[prodhub-host] AI (Foundry) configured=${configured} deployment=${DEPLOYMENT}`)

// Single entrypoint for both callable (fns.call) and streaming (fns.stream) names.
router.post('/:name', requireAuth, async (req, res) => {
  if (!configured) {
    return res.status(503).json({
      error: 'ai_not_configured',
      detail: 'Set AZURE_FOUNDRY_ENDPOINT + AZURE_FOUNDRY_KEY (deployment claude-opus-4-8) in App Service settings to enable AI.',
      name: req.params.name,
    })
  }
  // Foundry Claude handlers are ported per-name once creds are present. Returning an
  // explicit 501 rather than a fabricated answer keeps the "never fake working" rule.
  return res.status(501).json({ error: 'ai_handler_not_ported', name: req.params.name })
})

module.exports = router
