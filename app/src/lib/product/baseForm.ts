// baseForm.ts — upload + identify a product's base coverage form. Shared by every
// product-create path so "a product is created with a base coverage form" is enforced
// one way. The file goes to Storage through the adapter; identifyBaseForm reads its
// header (best-effort) to fill formNumber/title/edition/lob. Returns exactly the shape
// persisted on Product.baseForm. AI stays server-side (identify is a callable).
import { adapter } from '../backend'

export interface BaseFormMeta {
  path: string
  url: string
  name: string
  uploadedAt: string
  uploadedBy: string
  formNumber?: string
  title?: string
  edition?: string
  lob?: string
}

// Chunked base64 — avoids call-stack overflow on large PDFs (mirrors BaseFormExtract).
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH))
  return btoa(bin)
}

const SUPPORTED = /\.(pdf|txt|md)$/i
export function isSupportedBaseForm(f: File): boolean {
  return f.type === 'application/pdf' || f.type === 'text/plain' || SUPPORTED.test(f.name)
}

/** Upload the file to Storage and (best-effort) identify its header. Never throws on
 *  the identify step — a form that can't be read is still uploaded and usable. */
export async function uploadAndIdentifyBaseForm(
  file: File,
  actor: { uid: string },
  productId: string,
): Promise<BaseFormMeta> {
  const path = `uploads/${actor.uid}/baseforms/${productId}/${Date.now()}-${file.name}`
  const url = await adapter.storage.upload(path, file)
  const meta: BaseFormMeta = { path, url, name: file.name, uploadedAt: new Date().toISOString(), uploadedBy: actor.uid }

  try {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    const buf = await file.arrayBuffer()
    const payload = isPdf
      ? { formBase64: toBase64(buf), mediaType: 'application/pdf', fileName: file.name }
      : { formText: new TextDecoder().decode(buf), fileName: file.name }
    const id = await adapter.fns.call<typeof payload, { title: string; formNumber: string; edition: string; lob: string }>('identifyBaseForm', payload)
    if (id.title)      meta.title      = id.title
    if (id.formNumber) meta.formNumber = id.formNumber
    if (id.edition)    meta.edition    = id.edition
    if (id.lob)        meta.lob        = id.lob
  } catch {
    // identify is best-effort — the form is still uploaded and grounds later extraction.
  }
  return meta
}
