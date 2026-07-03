// duckcreek.ts — Duck Creek XML export seam (coming soon). The menu item that
// points here is intentionally disabled in the UI; this module defines the target
// shape so the wiring exists ahead of the implementation.
// AWS-SWAP: unchanged — this is a pure client transform; only the download path
// (Blob today, S3 presigned URL later) differs by backend.
import type { ProductExport } from '../export/excel'

/** The Duck Creek product-XML export. Not yet implemented. */
export function exportDuckCreekXML(_data: ProductExport): never {
  // TODO: map ProductExport → Duck Creek Example Product XML (Manuscripts,
  // rating worksheets, form lists). Tracked as a follow-up.
  throw new Error('Duck Creek XML export is coming soon.')
}

/** Whether the Duck Creek export is available yet (drives the disabled menu item). */
export const DUCK_CREEK_ENABLED = false
