'use strict'
// storage.js — /api/storage/* : object storage on Azure Blob (replaces Firebase Storage).
//
// Wired from AZURE_BLOB_CONNECTION (+ AZURE_BLOB_CONTAINER, default "uploads").
// Honest 503 until configured — never a fake URL. Uses @azure/storage-blob if the
// package is present; otherwise reports that the dependency/creds are pending.

const express = require('express')
const { requireAuth, requireRole } = require('./auth')

const router = express.Router()
const CONN = process.env.AZURE_BLOB_CONNECTION
const CONTAINER = process.env.AZURE_BLOB_CONTAINER || 'uploads'

let containerClient = null
if (CONN) {
  try {
    const { BlobServiceClient } = require('@azure/storage-blob')
    containerClient = BlobServiceClient.fromConnectionString(CONN).getContainerClient(CONTAINER)
    containerClient.createIfNotExists().catch(() => {})
    console.log('[prodhub-host] Blob storage configured')
  } catch (e) {
    console.warn('[prodhub-host] @azure/storage-blob unavailable:', e.message)
  }
}

function guard(res) {
  if (!containerClient) { res.status(503).json({ error: 'storage_not_configured', detail: 'Set AZURE_BLOB_CONNECTION in App Service settings to enable uploads.' }); return false }
  return true
}

// Upload (EDITOR+): base64 body → blob → returns a URL.
router.post('/upload', requireRole('EDITOR'), async (req, res) => {
  if (!guard(res)) return
  const { path, contentType, dataBase64 } = req.body || {}
  try {
    const blob = containerClient.getBlockBlobClient(path)
    const buf = Buffer.from(dataBase64, 'base64')
    await blob.upload(buf, buf.length, { blobHTTPHeaders: { blobContentType: contentType || 'application/octet-stream' } })
    res.json({ url: blob.url })
  } catch (e) { res.status(500).json({ error: 'upload_failed', detail: String(e.message || e) }) }
})

router.get('/url', requireAuth, async (req, res) => {
  if (!guard(res)) return
  res.json({ url: containerClient.getBlockBlobClient(String(req.query.path)).url })
})

module.exports = router
