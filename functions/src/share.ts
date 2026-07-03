// share.ts — creates share links (callable), serves read-only snapshots (callable),
// and renders the public shared page with a clean social card (onRequest, wired to
// the /share/** hosting rewrite).
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { randomBytes } from 'crypto'

// Initialize Admin SDK once per cold start.
if (!getApps().length) initializeApp()

// ─── Public shared page (onRequest) — per-product OG card + clean summary ──────

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function page(opts: { title: string; description: string; image: string; body: string }): string {
  const { title, description, image, body } = opts
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#C026D3">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Product Reinvention Hub">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;font-family:Inter,system-ui,-apple-system,sans-serif;background:#F7F7FA;color:#131318;
  min-height:100svh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{width:100%;max-width:520px;background:#fff;border:1px solid rgba(19,19,26,.08);border-radius:18px;
  padding:32px;box-shadow:0 1px 2px rgba(19,19,26,.04),0 14px 34px rgba(192,38,211,.08)}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:24px}
.logo{width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#9333EA,#C026D3,#DB2777)}
.brand span{font-weight:600;font-size:15px;letter-spacing:-.2px}
.pill{display:inline-block;font:600 11px/1.4 'JetBrains Mono',monospace;color:#C026D3;background:rgba(192,38,211,.08);
  padding:4px 10px;border-radius:999px;margin-bottom:14px}
h1{font-size:26px;font-weight:800;letter-spacing:-.5px;margin:0 0 6px}
.ref{font:600 13px 'JetBrains Mono',monospace;color:#5B5C6B;margin-bottom:16px}
.desc{color:#5B5C6B;line-height:1.6;margin:0 0 20px}
.stats{display:flex;gap:20px;padding:16px 0;border-top:1px solid rgba(19,19,26,.08);border-bottom:1px solid rgba(19,19,26,.08);margin-bottom:20px}
.stat b{display:block;font-size:20px;font-weight:800}.stat s{display:block;font-size:12px;color:#8E90A0;text-decoration:none}
.cta{display:inline-block;background:linear-gradient(135deg,#9333EA,#C026D3,#DB2777);color:#fff;text-decoration:none;
  font-weight:600;font-size:14px;padding:12px 22px;border-radius:12px;box-shadow:0 6px 22px rgba(192,38,211,.3)}
.foot{margin-top:18px;font-size:12px;color:#8E90A0}
</style></head>
<body><div class="card">
<div class="brand"><span class="logo"></span><span>Product Reinvention Hub</span></div>
${body}
</div></body></html>`
}

/**
 * Public shared product page. Wired to the `/share/**` hosting rewrite: serves
 * crawler-friendly per-product Open Graph tags and a clean read-only summary.
 * AWS-SWAP: CloudFront → Lambda@Edge / API Gateway route serving the same HTML.
 */
export const share = onRequest({ maxInstances: 10 }, async (req, res) => {
  const token = req.path.split('/').filter(Boolean).pop() ?? ''
  const origin = `${req.headers['x-forwarded-proto'] ?? 'https'}://${req.headers.host ?? 'productreinvention.web.app'}`
  const image = `${origin}/og-card.svg`
  res.set('Cache-Control', 'public, max-age=300')

  const linkDoc = token ? await getFirestore().doc(`shareLinks/${token}`).get() : null
  if (!linkDoc || !linkDoc.exists) {
    res.status(404).send(page({ title: 'Shared product not found', description: 'This share link is invalid.', image,
      body: `<h1>Link not found</h1><p class="desc">This share link is invalid or has been removed.</p><a class="cta" href="${origin}/">Go to the Hub →</a>` }))
    return
  }

  const link = linkDoc.data() as { productId: string; expiresAt: Timestamp }
  if (link.expiresAt.toDate() < new Date()) {
    res.status(410).send(page({ title: 'Shared link expired', description: 'This shared snapshot has expired.', image,
      body: `<h1>Link expired</h1><p class="desc">This shared snapshot is no longer available.</p><a class="cta" href="${origin}/">Go to the Hub →</a>` }))
    return
  }

  const db = getFirestore()
  const productDoc = await db.doc(`products/${link.productId}`).get()
  const p = (productDoc.data() ?? {}) as { name?: string; refId?: string; description?: string; marketSegment?: string; lob?: { name?: string }; states?: string[]; allStates?: boolean }
  const covCount = await db.collection(`products/${link.productId}/coverages`).count().get().then(s => s.data().count).catch(() => 0)
  const stateCount = p.allStates ? 'All' : String((p.states ?? []).length)

  const title = `${p.name ?? 'Insurance product'} · Product Reinvention Hub`
  const description = p.description || `A shared read-only snapshot of ${p.name ?? 'an insurance product'}${p.lob?.name ? ` (${p.lob.name})` : ''}.`
  res.status(200).send(page({
    title, description, image,
    body: `
      <span class="pill">Read-only shared snapshot</span>
      <h1>${esc(p.name ?? 'Insurance product')}</h1>
      ${p.refId ? `<div class="ref">${esc(p.refId)}</div>` : ''}
      <p class="desc">${esc(p.description || description)}</p>
      <div class="stats">
        <div class="stat"><b>${covCount}</b><s>coverages</s></div>
        <div class="stat"><b>${esc(stateCount)}</b><s>states</s></div>
        <div class="stat"><b>${esc(p.lob?.name ?? '—')}</b><s>line of business</s></div>
      </div>
      <a class="cta" href="${origin}/">Open Product Reinvention Hub →</a>
      <div class="foot">Snapshot expires ${esc(link.expiresAt.toDate().toLocaleDateString())}</div>`,
  }))
})

// ─── createShareLink callable ─────────────────────────────────────────────────

interface CreateShareInput  { productId: string }
interface CreateShareOutput { token: string; expiresAt: string }

export const createShareLink = onCall<CreateShareInput>(
  { maxInstances: 10 },
  async (request): Promise<CreateShareOutput> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to create a share link')

    const { productId } = request.data
    if (!productId) throw new HttpsError('invalid-argument', 'productId is required')

    const db        = getFirestore()
    const token     = randomBytes(20).toString('hex')
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

    // Verify product exists
    const productDoc = await db.doc(`products/${productId}`).get()
    if (!productDoc.exists) throw new HttpsError('not-found', 'Product not found')

    await db.doc(`shareLinks/${token}`).set({
      productId,
      createdBy: request.auth.uid,
      expiresAt: Timestamp.fromDate(expiresAt),
    })

    return { token, expiresAt: expiresAt.toISOString() }
  },
)

// ─── getShareSnapshot callable ────────────────────────────────────────────────

interface SnapshotInput  { token: string }
interface SnapshotOutput {
  product:   Record<string, unknown>
  coverages: Record<string, unknown>[]
  forms:     Record<string, unknown>[]
  expired:   false
}

export const getShareSnapshot = onCall<SnapshotInput>(
  { maxInstances: 10 },
  async (request): Promise<SnapshotOutput | { expired: true }> => {
    const { token } = request.data
    if (!token) throw new HttpsError('invalid-argument', 'token is required')

    const db      = getFirestore()
    const linkDoc = await db.doc(`shareLinks/${token}`).get()
    if (!linkDoc.exists) throw new HttpsError('not-found', 'Share link not found')

    const link = linkDoc.data() as { productId: string; expiresAt: Timestamp }
    if (link.expiresAt.toDate() < new Date()) return { expired: true }

    const productDoc   = await db.doc(`products/${link.productId}`).get()
    const coveragesSnap = await db.collection(`products/${link.productId}/coverages`).get()
    const formsSnap     = await db.collection('forms').get()

    const productData = { id: productDoc.id, ...productDoc.data() }
    const coverages   = coveragesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const allForms    = formsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    const forms = allForms.filter(f => {
      const d    = f as Record<string, unknown>
      const refs = (d['productRefIds'] as string[] | undefined) ?? []
      return refs.includes(link.productId)
    })

    return { product: productData, coverages, forms, expired: false }
  },
)
