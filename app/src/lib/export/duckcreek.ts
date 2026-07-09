// duckcreek.ts — client-side Duck Creek manuscript export. Pure computation:
// builds the PDM from live product-context data, serializes to XML and validates.
// No network calls; all three operations run in the browser from @pf/shared pure
// functions. The network call (audit event) lives in the modal after the user
// confirms the download.
import {
  buildPdm, serializePdmToDuckCreek, validateDuckCreek,
  resolveLob, DEFAULT_DUCKCREEK_MAPPING, composeManuscriptId,
} from '@pf/shared'
import type {
  Product, Coverage, FormRule, Rule, Form,
  LDTable, RTTable, RatingProgram, PdmProduct, ValidationReport,
} from '@pf/shared'

/** Everything the Duck Creek export needs — a superset of ProductExport that adds
 *  formRules (needed for the PDM builder's form-attach rules section). */
export interface DuckCreekExportData {
  product:       Product & { id: string }
  coverages:     Coverage[]
  rules:         Rule[]
  formRules:     FormRule[]
  forms:         Form[]
  ldTables:      Record<string, LDTable>
  rtTables:      Record<string, RTTable>
  ratingProgram: RatingProgram | null
}

export interface DuckCreekExportResult {
  pdm:          PdmProduct
  xml:          string
  report:       ValidationReport
  manuScriptID: string
  fileName:     string
}

/**
 * Build + serialize + validate the Duck Creek manuscript for one product.
 * Pure — no side effects, no network. Throws only if the product has no rating
 * program (required by the PDM builder).
 */
export function buildDuckCreekExport(data: DuckCreekExportData): DuckCreekExportResult {
  if (!data.ratingProgram) {
    throw new Error('No rating program found for this product — cannot build manuscript.')
  }

  const lob = resolveLob(data.product)
  const pdm = buildPdm({
    product:       data.product,
    lob,
    coverages:     data.coverages,
    forms:         data.forms,
    rules:         data.rules,
    formRules:     data.formRules,
    ratingProgram: data.ratingProgram,
    rtTables:      data.rtTables,
    ldTables:      data.ldTables,
  })

  const xml    = serializePdmToDuckCreek(pdm)
  const report = validateDuckCreek(pdm, xml)

  const manuScriptID = composeManuscriptId(DEFAULT_DUCKCREEK_MAPPING, lob.prefix, 'viewModel')
  const safeRef      = (data.product.refId ?? data.product.name ?? 'product').replace(/[^A-Za-z0-9.-]+/g, '_')
  const fileName     = `${safeRef}_duckcreek.xml`

  return { pdm, xml, report, manuScriptID, fileName }
}

/** Trigger a browser XML download. Not called in tests (DOM-only). */
export function downloadXml(xml: string, fileName: string): void {
  const blob = new Blob([xml], { type: 'application/xml' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = fileName; a.click()
  URL.revokeObjectURL(url)
}
