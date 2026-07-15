// Identity derivations (spec §2 — refId is load-bearing; the DC id grammar is
// dotted Object.Field with PascalCase segments).

/**
 * "PascalCase" per the observed sanitization rule (spec §2): strip every
 * character outside [A-Za-z0-9] and concatenate, PRESERVING the source casing —
 * no re-title-casing anywhere. Observed proofs: "Medical Payments Limit (any one
 * person)" → "MedicalPaymentsLimitanyoneperson" (InputFields!E5), "Physical
 * damage coverage elected" → "Physicaldamagecoverageelected" (InputFields!E9),
 * "Medical Payments Rate by Territory" → "MedicalPaymentsRatebyTerritory"
 * (TableConfig·Config!F16 — "by" stays lowercase).
 */
export function pascalCase(s: string): string {
  return s.replace(/[^A-Za-z0-9]+/g, '')
}

/**
 * The workbook/interview display name for a coverage. The golden CoverageConfig
 * (Coverage!B2 "Liability Coverage" vs the Hub's "Part A — Liability Coverage")
 * strips the ISO part-letter prefix.
 */
export function coverageDisplayName(name: string): string {
  return name.replace(/^Part\s+[A-Z]\s+[—–-]\s+/u, '')
}

/** Express input-field id: `<PascalCaseCoverageName>Input.<PascalCaseFieldName>` (spec §2). */
export function fieldId(coverageDisplay: string, fieldLabel: string): string {
  return `${pascalCase(coverageDisplay)}Input.${pascalCase(fieldLabel)}`
}

/** The input-object container prefix of a dotted field id ("X.Y" → "X"). */
export function idPrefix(dottedId: string): string {
  const dot = dottedId.indexOf('.')
  return dot < 0 ? dottedId : dottedId.slice(0, dot)
}

// ─── Manuscript identity — one setting, three forms (spec §1.1) ───────────────

/** Bare manuscript id for `properties@inherited` — no `.xml` suffix. */
export function bareManuscriptId(id: string): string {
  return id.replace(/\.xml$/i, '')
}

/** File-name form for workbook ManuscriptID columns: `<bare>.xml`. */
export function manuscriptFileName(id: string): string {
  return `${bareManuscriptId(id)}.xml`
}

/**
 * Per-sheet `MS Physical Path:` preamble value — byte-shaped as observed in the
 * golden TableConfig (row 4): the DCT template root + file-name form + `.xml`
 * (the observed value really does end `.xml.xml`).
 */
export function manuscriptPhysicalPath(id: string, root: string): string {
  return `${root}${manuscriptFileName(id)}.xml`
}

/** Overlay manuscriptID: `<Tenant>_<RefIdSafe>_<version>` (spec §3.1). */
export function overlayManuscriptId(tenantName: string, productRefId: string, version = '1_0_0_0'): string {
  const refIdSafe = productRefId.replace(/[^A-Za-z0-9]+/g, '_')
  return `${pascalCase(tenantName)}_${refIdSafe}_${version}`
}

// ─── TableConfig sheet naming (spec §3.4) ─────────────────────────────────────

/**
 * SheetName = PascalCase(TableName) + `_<ordinal>`, truncated to Excel's 31-char
 * limit (truncation may eat the ordinal — observed: "ProtectionClassConstructionFact",
 * "ScheduledPersonalPropertyClassR" — TableConfig·Config!F3, F8).
 */
export function tableSheetName(tableName: string, ordinal: number): string {
  return `${pascalCase(tableName)}_${ordinal}`.slice(0, 31)
}

/** DC-side table id (tableRef target): PascalCase(TableName) (spec §3.6). */
export function tableDcId(tableName: string): string {
  return pascalCase(tableName)
}

/** ISO date (yyyy-mm-dd) for versionDate / effectiveDate defaults. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
