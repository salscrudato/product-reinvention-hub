'use strict'
// news-image.js — GET /api/news/image/:hash
// Streams a persisted news thumbnail from Azure Blob (news-images/<sha1>) with
// long-lived cache headers. Hash-addressed (sha1 of the article URL) and pinned
// to the news-images/ prefix, so no path traversal is possible. Auth rides the
// global /api floor (Bearer or the HTTP-only session cookie — which is what an
// <img> tag sends). Misses return 404 and the client falls back to its branded
// gradient.

const HASH_RE = /^[0-9a-f]{40}$/

async function newsImage(req, res) {
  const hash = String(req.params.hash || '').toLowerCase()
  if (!HASH_RE.test(hash)) return res.status(400).json({ error: 'invalid_hash' })
  const conn = process.env.AZURE_BLOB_CONNECTION
  if (!conn) return res.status(503).json({ error: 'storage_not_configured' })
  try {
    const { BlobServiceClient } = require('@azure/storage-blob')
    const container = process.env.AZURE_BLOB_CONTAINER || 'uploads'
    const client = BlobServiceClient.fromConnectionString(conn)
      .getContainerClient(container).getBlockBlobClient(`news-images/${hash}`)
    const dl = await client.download()
    res.set({
      'Content-Type': dl.contentType || 'image/jpeg',
      'Cache-Control': dl.cacheControl || 'public, max-age=604800, immutable',
      ...(dl.contentLength ? { 'Content-Length': String(dl.contentLength) } : {}),
    })
    dl.readableStreamBody.pipe(res)
  } catch (err) {
    if (err?.statusCode === 404) return res.status(404).json({ error: 'not_found' })
    console.warn('[news-image] stream failed:', err?.message || err)
    return res.status(502).json({ error: 'blob_unavailable' })
  }
}

module.exports = { newsImage }
