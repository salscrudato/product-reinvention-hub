// functions/src/import/index.ts — UNIFIED import pipeline entry point.
//
// ONE function (runUnifiedImportPipeline) handles ALL formats:
//   ISO XLSX workbooks, SERFF packages, ERC packages, and company filing PDFs.
//
// The seven shared pipeline stages apply to every upload:
//   1. fingerprint   → FormatFingerprint (fingerprint.ts: pure, no AI)
//   2. plan          → ExtractionPlan    (plan.ts: registry-driven, pure)
//   3. split         → SplitProductProposal[] (split.ts: pure)
//   4. extract       → format-specific extraction (DETERMINISTIC or AI)
//   5. bulkTables    → ParsedTable per RTTable (deterministic + sampled AI verify)
//   6. reconcile     → UnifiedProposalBundle (wraps existing reconcileFiling)
//   7. formatCards   → FormatCard proposal when format is UNKNOWN
//
// The legacy `filingImport` Cloud Function in ../filingImport.ts is preserved
// unchanged for backwards compatibility.
//
// AWS-SWAP: onRequest → Lambda URL; auth + secret handling live in runtime.ts.

import { onRequest } from 'firebase-functions/v2/https'
import type Anthropic from '@anthropic-ai/sdk'
import {
  anthropic, authenticate, AuthError, MODEL_FAST, openSse, send,
  ANTHROPIC_API_KEY,
} from '../runtime'
import type { StreamEvent } from '../runtime'
import { sseCostGate } from '../ai'
import { emptyUsage, recordCascade, recordUsage } from '../telemetry'
import type { UsageAccum } from '../telemetry'
import { extractPdfText } from '../pdfText'
import { runFilingPipeline } from '../filingImport'
import { mapIsoWorkbook } from '@pf/shared'
import type {
  UnifiedProposalBundle, SampledVerification, SplitProductProposal, UploadDoc, FormatCard,
} from '@pf/shared'
import { fingerprintUpload } from './fingerprint'
import { planExtraction } from './plan'
import { planProductSplit, detectFormVariantsFromSheets } from './split'
import { parseXlsxBulkTables } from './bulkTables'
import { proposeFormatCard } from './formatCards'
import { wrapFilingBundle, wrapWorkbookBundle, buildEmptyBundle } from './reconcile'

export type { UploadDoc }
export { fingerprintUpload, planExtraction, planProductSplit, detectFormVariantsFromSheets }

// ─── Pipeline options ─────────────────────────────────────────────────────────

export interface UnifiedPipelineOpts {
  client:           Anthropic
  documents:        UploadDoc[]
  productNameHint?: string
  filingStateHint?: string
  degraded:         boolean
  cheapUsage:       UsageAccum
  strongUsage:      UsageAccum
  emit?:            (ev: StreamEvent) => void
}

// ─── The unified pipeline ─────────────────────────────────────────────────────

/** Run all seven pipeline stages and return the reviewable bundle. Pure of HTTP/SSE
 *  (the `emit` callback is the only side channel) so a test drives it with a fake client.
 *  The existing runFilingPipeline() (from filingImport.ts) is REUSED for the
 *  COMPANY_FILING_PDF extract+reconcile stages — not re-implemented. */
export async function runUnifiedImportPipeline(
  opts: UnifiedPipelineOpts,
): Promise<{ bundle: UnifiedProposalBundle; escalated: boolean }> {
  const { client, documents, strongUsage } = opts
  const emit = opts.emit ?? (() => {})
  let escalated = false

  // ── Stage 1: Fingerprint ─────────────────────────────────────────────────────
  emit({ t: 'tool', name: 'fingerprint', phase: 'start' })

  // Extract PDF text for fingerprinting (text is also needed by the filing pipeline).
  // XLSX files need sheetNames from the client; they arrive pre-populated in UploadDoc.
  const docsWithText: UploadDoc[] = await Promise.all(documents.map(async d => {
    if (d.text) return d
    if (d.base64 && (d.mediaType ?? 'application/pdf') === 'application/pdf') {
      const extracted = extractPdfText(d.base64)
      return { ...d, text: extracted ?? undefined }
    }
    return d
  }))

  const fingerprint = fingerprintUpload(docsWithText)
  emit({
    t: 'tool', name: 'fingerprint', phase: 'end',
    summary: `${fingerprint.detectedFormat} · ${fingerprint.lineGuesses[0]?.lobRefId ?? 'line unknown'}`,
  })
  emit({ t: 'json', key: 'fingerprint', value: fingerprint })

  // ── Stage 2: Plan ────────────────────────────────────────────────────────────
  emit({ t: 'tool', name: 'plan', phase: 'start' })
  const extractionPlan = planExtraction(fingerprint)
  emit({
    t: 'tool', name: 'plan', phase: 'end',
    summary: `${extractionPlan.format} / ${extractionPlan.lobRefId} / ${extractionPlan.splitStrategy}`,
  })
  emit({ t: 'json', key: 'extractionPlan', value: {
    format:         extractionPlan.format,
    lobRefId:       extractionPlan.lobRefId,
    splitStrategy:  extractionPlan.splitStrategy,
    assignments:    extractionPlan.documentRoleAssignments.length,
  }})

  // ── FormatCard for UNKNOWN formats ────────────────────────────────────────────
  let formatCard: FormatCard | undefined
  if (fingerprint.detectedFormat === 'UNKNOWN') {
    emit({ t: 'notice', level: 'warn', message: 'Format not recognized — proposing a FormatCard for human review.' })
    formatCard = await proposeFormatCard(client, fingerprint, docsWithText, strongUsage, emit)
    escalated = true
  }

  // ── Stage 3: Split ───────────────────────────────────────────────────────────
  emit({ t: 'tool', name: 'split', phase: 'start' })
  const formVariants = fingerprint.detectedFormat === 'ISO_WORKBOOK'
    ? detectFormVariantsFromSheets(docsWithText.flatMap(d => d.sheetNames ?? []))
    : []
  const splitProducts: SplitProductProposal[] = planProductSplit(extractionPlan, formVariants)
  emit({
    t: 'tool', name: 'split', phase: 'end',
    summary: `${splitProducts.length} product proposal(s)`,
  })

  const sampledVerifications: SampledVerification[] = []

  // ── Stages 4–6: Format-specific extract + bulkTables + reconcile ─────────────
  let bundle: UnifiedProposalBundle

  if (fingerprint.detectedFormat === 'ISO_WORKBOOK') {
    bundle = await processIsoWorkbook(docsWithText, fingerprint, extractionPlan, sampledVerifications, splitProducts, emit)
  } else if (
    fingerprint.detectedFormat === 'COMPANY_FILING_PDF' ||
    fingerprint.detectedFormat === 'UNKNOWN'
  ) {
    const result = await processFilingPdf(
      docsWithText, fingerprint, extractionPlan, sampledVerifications, splitProducts,
      formatCard, opts,
    )
    bundle = result.bundle
    escalated = escalated || result.escalated
  } else {
    // SERFF_PACKAGE, ERC_PACKAGE, ACORD — deterministic parse not yet implemented;
    // surface as UNRESOLVED for manual review.
    bundle = buildEmptyBundle(
      fingerprint, extractionPlan, sampledVerifications, splitProducts,
      `${fingerprint.detectedFormat} extraction not yet implemented — submit for manual review.`,
      formatCard,
    )
  }

  emit({ t: 'json', key: 'bundle', value: bundle })
  return { bundle, escalated }
}

// ─── ISO workbook path ─────────────────────────────────────────────────────────
// Deterministic: exceljs parse → mapIsoWorkbook → wrapWorkbookBundle. No AI calls.

async function processIsoWorkbook(
  docs: UploadDoc[],
  fingerprint: ReturnType<typeof fingerprintUpload>,
  extractionPlan: ReturnType<typeof planExtraction>,
  sampledVerifications: SampledVerification[],
  splitProducts: SplitProductProposal[],
  emit: (ev: StreamEvent) => void,
): Promise<UnifiedProposalBundle> {
  emit({ t: 'tool', name: 'extract:workbook', phase: 'start' })

  const xlsxDoc = docs.find(d =>
    d.mediaType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    d.name.toLowerCase().endsWith('.xlsx'),
  )

  if (!xlsxDoc?.base64) {
    emit({ t: 'tool', name: 'extract:workbook', phase: 'end', summary: 'No XLSX content — nothing to parse' })
    return buildEmptyBundle(
      fingerprint, extractionPlan, sampledVerifications, splitProducts,
      'No XLSX binary content was provided for the ISO workbook upload.',
    )
  }

  // ① Deterministic XLSX cell read — no AI (Stage 5: bulkTables)
  const grids = await parseXlsxBulkTables(xlsxDoc.base64)
  emit({ t: 'tool', name: 'extract:workbook', phase: 'end', summary: `${grids.length} sheet(s) read` })

  // ② Map grids to ImportPlan using the existing pure ISO mapper (Stage 6: reconcile)
  emit({ t: 'tool', name: 'reconcile', phase: 'start' })
  const importPlan = mapIsoWorkbook(grids)
  const itemCount = Object.values(importPlan.summary.counts ?? {}).reduce((a, b) => a + b, 0)
  emit({ t: 'tool', name: 'reconcile', phase: 'end', summary: `${itemCount} items mapped` })

  return wrapWorkbookBundle(importPlan, fingerprint, extractionPlan, sampledVerifications, splitProducts)
}

// ─── Company filing PDF path ───────────────────────────────────────────────────
// Reuses the existing CLASSIFY → EXTRACT → RECONCILE pipeline from filingImport.ts
// (runFilingPipeline). Wraps its output in a UnifiedProposalBundle.

async function processFilingPdf(
  docs: UploadDoc[],
  fingerprint: ReturnType<typeof fingerprintUpload>,
  extractionPlan: ReturnType<typeof planExtraction>,
  sampledVerifications: SampledVerification[],
  splitProducts: SplitProductProposal[],
  formatCard: FormatCard | undefined,
  opts: UnifiedPipelineOpts,
): Promise<{ bundle: UnifiedProposalBundle; escalated: boolean }> {
  // Convert UploadDoc[] → FilingDoc[] (drop sheetNames which filingImport doesn't know)
  const filingDocs = docs.map(d => ({
    name: d.name, base64: d.base64, text: d.text, mediaType: d.mediaType,
  }))

  // Delegate to the existing pipeline (reuse, not re-implement)
  const { bundle: filingBundle, escalated } = await runFilingPipeline({
    ...opts,
    documents: filingDocs,
  })

  const unified = wrapFilingBundle(
    filingBundle, fingerprint, extractionPlan, sampledVerifications, splitProducts, formatCard,
  )
  return { bundle: unified, escalated }
}

// ─── HTTP handler ──────────────────────────────────────────────────────────────

interface UnifiedImportBody {
  documents?:   UploadDoc[]
  productName?: string
  filingState?: string
  sessionId?:   string
}

export const unifiedImport = onRequest(
  { secrets: [ANTHROPIC_API_KEY], cors: true, timeoutSeconds: 300, memory: '1GiB' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

    // Author-only: the importer proposes writes, so guard like a mutation — same role
    // requirement as filingImport (mirrors the Firestore rules the eventual mutate() hits).
    let caller
    try {
      caller = await authenticate(req)
      if (caller.role !== 'EDITOR' && caller.role !== 'ADMIN') {
        res.status(403).json({ error: 'Editor access required.' }); return
      }
    } catch (e) {
      res.status(401).json({ error: e instanceof AuthError ? e.message : 'Unauthorized' }); return
    }

    openSse(res)
    const cheapUsage = emptyUsage()
    const strongUsage = emptyUsage()
    let escalated = false
    let blocked: 'deny' | 'breaker' | null = null
    const t0 = Date.now()
    let ok = true
    const body = (req.body ?? {}) as UnifiedImportBody
    const sessionKey = body.sessionId?.trim() || caller.uid

    try {
      const documents = (body.documents ?? []).filter(d => d && (d.base64 || d.text) && d.name)
      if (documents.length === 0) { send(res, { t: 'error', message: 'No documents provided.' }); return }
      if (documents.length > 8)   { send(res, { t: 'error', message: 'Too many documents (max 8).' }); return }

      // Share the filingImport cost gate — same budget category
      const gate = await sseCostGate(res, 'filingImport', sessionKey)
      if (!gate.proceed) { blocked = gate.blocked; return }

      const { escalated: didEscalate } = await runUnifiedImportPipeline({
        client:           anthropic(),
        documents,
        productNameHint:  body.productName,
        filingStateHint:  body.filingState,
        degraded:         gate.degraded,
        cheapUsage,
        strongUsage,
        emit:             (ev) => send(res, ev),
      })
      escalated = didEscalate

      send(res, { t: 'done' })
    } catch (err) {
      ok = false
      console.error('[unifiedImport] internal error:', err)
      send(res, { t: 'error', message: 'Unified import failed.' })
    } finally {
      res.end()
      if (blocked) {
        void recordUsage({
          feature: 'filingImport', model: MODEL_FAST, usage: emptyUsage(),
          latencyMs: Date.now() - t0, ok: true, sessionKey,
          denied: blocked === 'deny', degraded: blocked === 'breaker', providerCalled: false,
        })
      } else {
        void recordCascade({
          feature: 'filingImport', cheapUsage, cheapLatencyMs: Date.now() - t0,
          ok, strongUsage: escalated ? strongUsage : undefined, sessionKey,
        })
      }
    }
  },
)
