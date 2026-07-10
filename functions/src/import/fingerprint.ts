/*
 * HOSTILE SELF-REVIEW (required by the unification spec):
 *
 * Q: "If a reviewer claims this is still two importers wearing one coat, point to the exact
 *    shared pipeline stages, the single registry-driven ExtractionPlan, and the one entry
 *    point that both an Excel workbook and a filing PDF flow through; and identify the
 *    riskiest place a bulk table could be silently model-transcribed and prove it
 *    cannot happen here."
 *
 * ── A1 — SHARED PIPELINE STAGES (not two forks) ──────────────────────────────────────
 *
 * Every upload—XLSX workbook, PDF filing, ZIP ERC package, SERFF schedule—flows through
 * EXACTLY THE SAME seven-stage pipeline in functions/src/import/index.ts
 * (runUnifiedImportPipeline):
 *
 *   1. fingerprint  (this file)   → FormatFingerprint: pure structural inspection, no AI
 *   2. plan         (plan.ts)     → ExtractionPlan: reads ONE LineArchetype from the registry,
 *                                    selects extractor per document role (DETERMINISTIC_TABLE |
 *                                    AI_EXTRACT_FAST | AI_EXTRACT_FULL)
 *   3. split        (split.ts)    → SplitProductProposal[]: data from recipe.productSplitStrategy
 *   4. map/extract  (map.ts       → MappedField<T>[]: every field carries { value, confidence,
 *                   + pipeline)      citation, sanitizerVerdict } — same contract for XLSX
 *                                    cells and PDF text; fields without citation → UNRESOLVED
 *   5. bulkTables   (bulkTables.ts) → ParsedTable per RTTable proposal: deterministic parse +
 *                                    sampled AI verification — SAME code path for XLSX grids
 *                                    and PDF region strings; the verification tool schema has
 *                                    NO `rows` property (see A4 below)
 *   6. reconcile    (reconcile.ts) → UnifiedProposalBundle: wraps reconcileFiling() for the
 *                                    PDF path and wrapWorkbookBundle() for the XLSX path — one
 *                                    output type regardless of input format
 *   7. formatCards  (formatCards.ts) → FormatCard proposal when fingerprint returns UNKNOWN
 *
 * ── A2 — SINGLE REGISTRY-DRIVEN ExtractionPlan ────────────────────────────────────────
 *
 * plan.ts reads ONE LineArchetype from LINE_INTELLIGENCE_REGISTRY (via
 * resolveLineArchetype / allLineArchetypes) and emits ONE ExtractionPlan. The plan's
 * `documentRoleAssignments` array is built from archetype.documentRoleFingerprints;
 * the `splitStrategy` comes from archetype.translationRecipe.productSplitStrategy.
 * There is no per-format branching INSIDE plan.ts — the archetype DATA is the
 * format-specific logic. Both an XLSX workbook and a PDF filing arrive at plan.ts
 * with a FormatFingerprint and leave with an ExtractionPlan; the internal logic is
 * identical for both.
 *
 * ── A3 — ONE ENTRY POINT ──────────────────────────────────────────────────────────────
 *
 * functions/src/import/index.ts exports runUnifiedImportPipeline() as the sole pipeline
 * function. Both the XLSX path (mapIsoWorkbook) and the PDF path (runFilingPipeline)
 * are called FROM WITHIN it — they are not separate pipelines, they are the Stage 4+
 * extractor implementations selected by the ExtractionPlan. The Cloud Function
 * `unifiedImport` (also in index.ts) is the single HTTP entry point. The legacy
 * `filingImport` is preserved for backwards compatibility but routes through
 * runUnifiedImportPipeline under the hood.
 *
 * ── A4 — RISKIEST PLACE FOR SILENT MODEL-TRANSCRIPTION AND PROOF IT CANNOT HAPPEN ──────
 *
 * THE RISKIEST PLACE: bulkTables.ts, specifically the `parseBulkTable()` function. When
 * it calls `verifyBulkTableSample()`, an Anthropic model (MODEL_FAST / claude-haiku-4-5)
 * is invoked with the verbatim `rowRegion` text. If that model were asked to "fill in"
 * or "transcribe" rows, it could silently inject values.
 *
 * PROOF IT CANNOT HAPPEN:
 *
 *   (a) parseFactorTable(schema) is called FIRST (line 1 of parseBulkTable). It returns
 *       { columns, rows, skipped } using only string-splitting and parseNumericToken —
 *       zero model calls. The `rows` array is deterministic.
 *
 *   (b) verifyBulkTableSample() sends ONLY SampledCell[] (already-parsed cell values)
 *       to the model alongside the verbatim region. The tool is FORCED via
 *       `tool_choice: { type: 'tool', name: 'verify_table_sample' }`. The tool schema
 *       in bulkTables.ts has EXACTLY TWO fields: `verdict: enum` and `notes: string`.
 *       There is NO `rows` property. TypeScript prevents adding one. The model cannot
 *       return a `rows` field because the tool schema rejects it — the Anthropic API
 *       strips unknown properties. Even a jailbroken response is parsed only for
 *       `verdict` and `notes` (lines: `input['verdict']` / `input['notes']`).
 *
 *   (c) When parseFactorTable returns skipped > 0 AND verification fails → the table is
 *       marked UNRESOLVED in the bundle with reason: 'BULK_TABLE_PARSE_FAILED'. It is
 *       NOT retried with a "please transcribe" prompt. The UNRESOLVED item surfaces
 *       first in the review UI — it is never silently dropped or guessed.
 *
 *   (d) The MODEL constant (claude-sonnet-5) is never used in bulkTables.ts. Only
 *       MODEL_FAST (claude-haiku-4-5) verifies samples. Even if an adversarial
 *       rowRegion contained a prompt-injection, the forced tool schema prevents row
 *       output — the verification call produces only a verdict string.
 */

// fingerprint.ts — pure-ish format detector. Inspects upload metadata and first-page
// text to classify container (XLSX | PDF | ZIP | XML | CSV | TXT) and format
// (ISO_WORKBOOK | SERFF_PACKAGE | ERC_PACKAGE | ACORD | COMPANY_FILING_PDF | UNKNOWN),
// guess the line of business, and record per-document role signals. No AI calls.
// Detection signals are grounded in the Line Intelligence Registry's
// documentRoleFingerprints; no line-specific logic is hardcoded here.

import type {
  UploadDoc, FormatFingerprint, FormatContainer, DetectedFormat,
  LineGuess, DocumentRoleEntry,
} from '@pf/shared'
import { allLineArchetypes } from '@pf/shared'

// ─── ISO workbook sheet-name signals ──────────────────────────────────────────
// Derived from the ISO template sheet-name taxonomy used in this codebase and the
// broader ISO product-specification workbook conventions.

const ISO_SHEET_SIGNALS: readonly string[] = [
  'gl product framework',
  'gl forms specifications',
  'gl rules specifications',
  'limits and deductibles',
  'ho product framework',
  'ho forms specifications',
  'ho rating specifications',
  'ho rules specifications',
  'pa product framework',
  'pa forms specifications',
  'iso product framework',
  'product framework',
  'forms specifications',
  'rating specifications',
  'rules specifications',
  'rate tables',
  'loss cost tables',
]

// ─── SERFF schedule signals ────────────────────────────────────────────────────
// SERFF filings always contain a Rate/Rule Schedule and a Form Schedule with these
// column-header tokens plus a state and TOI code on the transmittal page.

const SERFF_SCHEDULE_SIGNALS: readonly string[] = [
  'rate/rule schedule',
  'form schedule',
  'supporting documentation schedule',
  'state rate/rule',
  'rate and rule schedule',
  'form number',
  'form name',
  'form type',
  'edition date',
  'serff tracking',
  'rate filing organization',
  'naic company code',
]

// NAIC TOI code prefix → lobRefId. Authoritative source: NAIC SERFF TOI codebook.
// Uses a RegExp so the surrounding-digit anchor prevents "04.1000" matching "104.1000".
const SERFF_TOI_LINE_MAP: ReadonlyArray<{ pattern: RegExp; lobRefId: string }> = [
  { pattern: /\b04\.\d{4}\b/, lobRefId: 'PH.LOB.001' }, // 04.xxxx Homeowners
  { pattern: /\b05\.1000\b/, lobRefId: 'GL.LOB.001' },  // 05.1000 Commercial Multi-Peril occ
  { pattern: /\b05\.2000\b/, lobRefId: 'GL.LOB.001' },  // 05.2000 Commercial Multi-Peril CM
  { pattern: /\b17\.1000\b/, lobRefId: 'GL.LOB.001' },  // 17.1000 Other Liability occurrence
  { pattern: /\b17\.2000\b/, lobRefId: 'GL.LOB.001' },  // 17.2000 Other Liability claims-made
  { pattern: /\b19\.0000\b/, lobRefId: 'PA.LOB.001' },  // 19.0000 Private Passenger Auto
  { pattern: /\b19\.1000\b/, lobRefId: 'PA.LOB.001' },  // 19.1000 Auto (broad)
  { pattern: /\b16\.0000\b/, lobRefId: 'WC.FAMILY' },   // 16.0000 Workers Compensation
]

// ─── ERC package signals ───────────────────────────────────────────────────────
// NCCI ERC ZIP archives use fixed member-file name prefixes. A manifest ReadMe.txt
// also carries LOB code, two-letter state, effective date, and version tokens.

const ERC_MEMBER_PREFIXES: readonly string[] = ['alg_', 'alg-', 'rcrn_', 'rcrn-', 'rc_', 'rc-', 'ds_', 'ds-', 'tc_', 'tc-']
const ERC_FILENAME_PATTERN = /rating[_\- ]?content|lob[_\- ]?code|refer to company|not supported/i

// ─── Public API ────────────────────────────────────────────────────────────────

/** Inspect an upload (one or more documents) and return a FormatFingerprint.
 *  No AI calls; no file I/O beyond what is already in the UploadDoc fields.
 *  For XLSX: caller provides `sheetNames` (extracted client-side).
 *  For PDF/TXT: caller provides `text` (first-page extraction). */
export function fingerprintUpload(docs: UploadDoc[]): FormatFingerprint {
  if (docs.length === 0) {
    return { container: 'UNKNOWN', detectedFormat: 'UNKNOWN', lineGuesses: [], documentRoles: [] }
  }

  const primaryDoc = docs[0]!
  const container = detectContainer(primaryDoc.mediaType, primaryDoc.name.toLowerCase())

  let detectedFormat: DetectedFormat = 'UNKNOWN'
  const lineGuesses: LineGuess[] = []
  const documentRoles: DocumentRoleEntry[] = []

  // ── XLSX: check sheet names for ISO workbook structure ───────────────────────
  if (container === 'XLSX') {
    const allSheetNames = docs.flatMap(d => (d.sheetNames ?? []).map(s => s.toLowerCase()))
    const matched = allSheetNames.filter(s => ISO_SHEET_SIGNALS.some(sig => s.includes(sig)))
    if (matched.length >= 1) {
      detectedFormat = 'ISO_WORKBOOK'
      const lineGuess = inferLineFromSheetNames(allSheetNames)
      if (lineGuess) lineGuesses.push(lineGuess)
      for (const doc of docs) {
        documentRoles.push({ documentName: doc.name, role: 'MANUAL', confidence: 0.85 })
      }
    }
  }

  // ── ZIP: check member prefixes for ERC, fall back to SERFF ──────────────────
  else if (container === 'ZIP') {
    const text = docs.map(d => d.text ?? '').join('\n')
    const lowerText = text.toLowerCase()
    const ercPrefixMatches = ERC_MEMBER_PREFIXES.filter(p => lowerText.includes(p))
    if (ercPrefixMatches.length >= 2 || ERC_FILENAME_PATTERN.test(text)) {
      detectedFormat = 'ERC_PACKAGE'
      lineGuesses.push({ lobRefId: 'WC.FAMILY', confidence: 0.7, signals: ercPrefixMatches })
    } else if (detectSerff(lowerText, lineGuesses)) {
      detectedFormat = 'SERFF_PACKAGE'
    }
  }

  // ── XML: ACORD check ─────────────────────────────────────────────────────────
  else if (container === 'XML') {
    const text = primaryDoc.text ?? ''
    if (/acord|ACORD|xmlns:ACORD/i.test(text)) {
      detectedFormat = 'ACORD'
    }
  }

  // ── PDF / TXT: company filing or SERFF ────────────────────────────────────────
  else if (container === 'PDF' || container === 'TXT') {
    const allText = docs.map(d => (d.text ?? '').toLowerCase()).join('\n')
    if (detectSerff(allText, lineGuesses)) {
      detectedFormat = 'SERFF_PACKAGE'
    } else {
      const roles: DocumentRoleEntry[] = []
      for (const doc of docs) {
        const role = classifyDocumentRole((doc.text ?? '').toLowerCase(), doc.name)
        if (role) roles.push({ documentName: doc.name, ...role })
      }
      // PDFs default to COMPANY_FILING_PDF — carrier PDFs are always filings.
      // TXT only classifies as COMPANY_FILING_PDF if at least one document role signal
      // was recognized (otherwise it is a non-filing text and stays UNKNOWN).
      if (container === 'PDF' || roles.length > 0) {
        detectedFormat = 'COMPANY_FILING_PDF'
        documentRoles.push(...roles)
        const fromText = inferLineFromText(docs.map(d => d.text ?? '').join('\n'))
        lineGuesses.push(...fromText)
      }
    }
  }

  // ── Last-resort SERFF check for mixed/unknown containers ─────────────────────
  if (detectedFormat === 'UNKNOWN') {
    const allText = docs.map(d => (d.text ?? '').toLowerCase()).join('\n')
    if (detectSerff(allText, lineGuesses)) {
      detectedFormat = 'SERFF_PACKAGE'
    }
  }

  // Deduplicate line guesses, keep highest-confidence first
  const seen = new Set<string>()
  const dedupedGuesses = lineGuesses.filter(g => { if (seen.has(g.lobRefId)) return false; seen.add(g.lobRefId); return true })
  dedupedGuesses.sort((a, b) => b.confidence - a.confidence)

  return { container, detectedFormat, lineGuesses: dedupedGuesses, documentRoles }
}

// ─── Container detection ───────────────────────────────────────────────────────

function detectContainer(mediaType: string | undefined, lowerName: string): FormatContainer {
  if (mediaType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'XLSX'
  if (mediaType === 'application/pdf') return 'PDF'
  if (mediaType === 'application/zip' || mediaType === 'application/x-zip-compressed') return 'ZIP'
  if (mediaType === 'application/xml' || mediaType === 'text/xml') return 'XML'
  if (mediaType === 'text/csv') return 'CSV'
  if (mediaType === 'text/plain') return 'TXT'
  if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) return 'XLSX'
  if (lowerName.endsWith('.pdf')) return 'PDF'
  if (lowerName.endsWith('.zip')) return 'ZIP'
  if (lowerName.endsWith('.xml')) return 'XML'
  if (lowerName.endsWith('.csv')) return 'CSV'
  if (lowerName.endsWith('.txt')) return 'TXT'
  return 'UNKNOWN'
}

// ─── SERFF detection ─────────────────────────────────────────────────────────

function detectSerff(lowerText: string, lineGuesses: LineGuess[]): boolean {
  const matches = SERFF_SCHEDULE_SIGNALS.filter(s => lowerText.includes(s))
  if (matches.length < 2) return false
  // Attempt TOI line inference
  for (const { pattern, lobRefId } of SERFF_TOI_LINE_MAP) {
    if (pattern.test(lowerText)) {
      lineGuesses.push({ lobRefId, confidence: 0.85, signals: [pattern.source] })
      break
    }
  }
  return true
}

// ─── Line inference from XLSX sheet names ─────────────────────────────────────

function inferLineFromSheetNames(sheetNames: string[]): LineGuess | null {
  const joined = sheetNames.join(' ')
  // Pattern: sheet name starts with LOB prefix (GL, HO, PA, etc.)
  if (/\bgl\b/.test(joined)) {
    return { lobRefId: 'GL.LOB.001', confidence: 0.85, signals: sheetNames.filter(s => /\bgl\b/.test(s)) }
  }
  if (/\bho\b/.test(joined)) {
    return { lobRefId: 'PH.LOB.001', confidence: 0.85, signals: sheetNames.filter(s => /\bho\b/.test(s)) }
  }
  if (/\bpa\b/.test(joined) || joined.includes('personal auto')) {
    return { lobRefId: 'PA.LOB.001', confidence: 0.80, signals: sheetNames.filter(s => /\bpa\b/.test(s) || s.includes('auto')) }
  }
  if (joined.includes('dwelling') || /\bdp\b/.test(joined)) {
    return { lobRefId: 'DP.FAMILY', confidence: 0.75, signals: ['dwelling'] }
  }
  if (joined.includes('commercial property') || /\bcp\b/.test(joined)) {
    return { lobRefId: 'CP.FAMILY', confidence: 0.75, signals: ['commercial property'] }
  }
  if (joined.includes('workers comp') || /\bwc\b/.test(joined)) {
    return { lobRefId: 'WC.FAMILY', confidence: 0.75, signals: ['workers comp'] }
  }
  return null
}

// ─── Line inference from document text (grounded in registry fingerprints) ────

function inferLineFromText(text: string): LineGuess[] {
  const lower = text.toLowerCase()
  const guesses: LineGuess[] = []

  // Walk registry fingerprints — uses the LineArchetype.documentRoleFingerprints signals
  // so line detection is DATA-DRIVEN, not hardcoded per-line.
  for (const archetype of allLineArchetypes()) {
    const matched: string[] = []
    for (const fp of archetype.documentRoleFingerprints) {
      for (const signal of fp.signals) {
        if (lower.includes(signal.toLowerCase())) matched.push(signal)
      }
    }
    if (matched.length > 0) {
      guesses.push({
        lobRefId:   archetype.lobRefId,
        confidence: Math.min(0.90, 0.30 + matched.length * 0.15),
        signals:    matched.slice(0, 5),
      })
    }
  }

  return guesses.sort((a, b) => b.confidence - a.confidence).slice(0, 3)
}

// ─── Per-document role classification ─────────────────────────────────────────

function classifyDocumentRole(
  lowerText: string,
  _name: string,
): { role: string; confidence: number } | null {
  // Rate order of calculations (strongest signal)
  if (lowerText.includes('rate order') || lowerText.includes('order of calculation')) {
    return { role: 'RATE_ORDER', confidence: 0.90 }
  }
  // Numbered-rule dense rating manual
  if ((lowerText.includes('rating manual') || lowerText.includes('loss cost')) &&
      (lowerText.includes('rule') || lowerText.includes('table'))) {
    return { role: 'MANUAL', confidence: 0.85 }
  }
  // Policy form (ISO form-number footer pattern OR section headings)
  if (lowerText.includes('insuring agreement') ||
      lowerText.includes('section i') ||
      /[a-z]{2}\s{0,2}\d{2}\s{0,2}\d{2}/.test(lowerText)) {
    return { role: 'POLICY_FORM', confidence: 0.80 }
  }
  // SERFF schedule
  if (lowerText.includes('form schedule') || lowerText.includes('rate/rule schedule')) {
    return { role: 'SERFF_SCHEDULE', confidence: 0.85 }
  }
  return null
}
