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

// RISK-004: sanitize the blob path before passing to the Azure SDK.
// Reject any path that contains directory traversal sequences, backslashes,
// leading slashes, null bytes, or other control characters.
function sanitizeBlobPath(p) {
  const s = String(p || '')
  if (!s) return null
  if (s.includes('..') || s.includes('\\') || s.startsWith('/') || /[\x00-\x1f]/.test(s)) return null
  return s
}

// Server-side upload limits (upload root-cause fix): a decoded-size ceiling that fits
// under the host's 25 MB JSON body cap after base64 inflation (~4/3), and a content-type
// allowlist that blocks browser-active types (text/html, image/svg+xml, anything
// script-capable) from ever landing in blob storage. Callers today upload PDFs, plain
// text/markdown/CSV/JSON and raster screenshots (claims base forms, feedback attachments).
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
const ALLOWED_CONTENT = [
  /^application\/pdf$/i,
  /^application\/json$/i,
  /^text\/(plain|markdown|csv)$/i,
  /^image\/(png|jpe?g|gif|webp)$/i,
  /^application\/octet-stream$/i,   // extension-less text files (e.g. .md pickers report '')
]

// Upload (EDITOR+): base64 body -> blob -> returns a URL.
router.post('/upload', requireRole('EDITOR'), async (req, res) => {
  const { path, contentType, dataBase64 } = req.body || {}
  const safePath = sanitizeBlobPath(path)
  if (!safePath) return res.status(400).json({ error: 'invalid_path', detail: 'path must not contain .., \\, or begin with /.' })
  const type = String(contentType || 'application/octet-stream')
  if (!ALLOWED_CONTENT.some((re) => re.test(type))) {
    return res.status(415).json({ error: 'unsupported_type', detail: `Content type "${type}" is not accepted. Upload a PDF, text, or image file.` })
  }
  let buf
  try { buf = Buffer.from(String(dataBase64 || ''), 'base64') } catch { buf = null }
  if (!buf || buf.length === 0) return res.status(400).json({ error: 'missing_file', detail: 'Provide the file content as dataBase64.' })
  if (buf.length > MAX_UPLOAD_BYTES) {
    return res.status(413).json({
      error: 'payload_too_large',
      detail: `File is ${(buf.length / 1024 / 1024).toFixed(1)} MB — the upload limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
      maxBytes: MAX_UPLOAD_BYTES,
    })
  }
  if (!guard(res)) return
  try {
    const blob = containerClient.getBlockBlobClient(safePath)
    await blob.upload(buf, buf.length, { blobHTTPHeaders: { blobContentType: type } })
    res.json({ url: blob.url })
  } catch (e) { res.status(500).json({ error: 'upload_failed', detail: String(e.message || e) }) }
})

router.get('/url', requireAuth, async (req, res) => {
  if (!guard(res)) return
  res.json({ url: containerClient.getBlockBlobClient(String(req.query.path)).url })
})

module.exports = router
